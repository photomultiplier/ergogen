const m = require('makerjs')
const u = require('./utils')
const a = require('./assert')

const push_rotation = exports._push_rotation = (list, angle, origin) => {
    let candidate = origin
    for (const r of list) {
        candidate = m.point.rotate(candidate, r.angle, r.origin)
    }
    list.push({
        angle: angle,
        origin: candidate
    })
}

const render_zone = exports._render_zone = (zone_name, zone, anchor, global_key) => {

    // zone-wide sanitization

    a.detect_unexpected(zone, `points.zones.${zone_name}`, ['anchor', 'columns', 'rows', 'key'])
    // the anchor comes from "above", because it needs other zones too (for references)
    const cols = a.sane(zone.columns || {}, `points.zones.${zone_name}.columns`, 'object')
    const zone_wide_rows = a.sane(zone.rows || {'default': {}}, `points.zones.${zone_name}.rows`, 'object')
    for (const [key, val] of Object.entries(zone_wide_rows)) {
        zone_wide_rows[key] = a.sane(val || {}, `points.zones.${zone_name}.rows.${key}`, 'object')
    }
    const zone_wide_key = a.sane(zone.key || {}, `points.zones.${zone_name}.key`, 'object')

    // algorithm prep

    const points = {}
    const rotations = []
    // transferring the anchor rotation to "real" rotations
    rotations.push({
        angle: anchor.r,
        origin: anchor.p
    })

    // column layout

    let first_col = true
    for (let [col_name, col] of Object.entries(cols)) {

        // column-level sanitization

        col = col || {}

        a.detect_unexpected(
            col,
            `points.zones.${zone_name}.columns.${col_name}`,
            ['stagger', 'spread', 'rotate', 'origin', 'rows', 'row_overrides', 'key']
        )
        col.stagger = a.sane(
            col.stagger || 0,
            `points.zones.${zone_name}.columns.${col_name}.stagger`,
            'number'
        )
        col.spread = a.sane(
            col.spread || (first_col ? 0 : 19),
            `points.zones.${zone_name}.columns.${col_name}.spread`,
            'number'
        )
        col.rotate = a.sane(
            col.rotate || 0,
            `points.zones.${zone_name}.columns.${col_name}.rotate`,
            'number'
        )
        col.origin = a.xy(
            col.origin || [0, 0],
            `points.zones.${zone_name}.columns.${col_name}.origin`,
        )
        let override = false
        col.rows = a.sane(
            col.rows || {},
            `points.zones.${zone_name}.columns.${col_name}.rows`,
            'object'
        )
        if (col.row_overrides) {
            override = true
            col.rows = a.sane(
                col.row_overrides,
                `points.zones.${zone_name}.columns.${col_name}.row_overrides`,
                'object'
            )
        }
        for (const [key, val] of Object.entries(col.rows)) {
            col.rows[key] = a.sane(
                val || {},
                `points.zones.${zone_name}.columns.${col_name}.rows.${key}`,
                'object'
            )
        }
        col.key = a.sane(
            col.key || {},
            `points.zones.${zone_name}.columns.${col_name}.key`,
            'object'
        )

        // propagating object key to name field

        col.name = col_name

        // combining row data from zone-wide defs and col-specific defs
        // (while also handling potential overrides)

        const actual_rows = override ? Object.keys(col.rows)
            : Object.keys(a.extend(zone_wide_rows, col.rows))

        // setting up column-level anchor

        anchor.x += col.spread
        anchor.y += col.stagger
        const col_anchor = anchor.clone()
        // clear potential rotations, as they will get re-applied anyway
        // and we don't want to apply them twice...
        col_anchor.r = 0

        // applying col-level rotation (cumulatively, for the next columns as well)

        if (col.rotate) {
            push_rotation(
                rotations,
                col.rotate,
                col_anchor.clone().shift(col.origin, false).p
            )
        }

        // getting key config through the 5-level extension

        const keys = []
        const default_key = {
            shift: [0, 0],
            rotate: 0,
            padding: 19,
            skip: false,
            asym: 'both'
        }
        for (const row of actual_rows) {
            const key = a.extend(
                default_key,
                global_key,
                zone_wide_key,
                col.key,
                zone_wide_rows[row] || {},
                col.rows[row] || {}
            )

            key.name = key.name || `${zone_name}_${col_name}_${row}`
            key.colrow = `${col_name}_${row}`
            key.shift = a.xy(key.shift, `${key.name}.shift`)
            key.rotate = a.sane(key.rotate, `${key.name}.rotate`, 'number')
            key.padding = a.sane(key.padding, `${key.name}.padding`, 'number')
            key.skip = a.sane(key.skip, `${key.name}.skip`, 'boolean')
            key.asym = a.in(key.asym, `${key.name}.asym`, ['left', 'right', 'both'])
            key.col = col
            key.row = row
            keys.push(key)
        }

        // actually laying out keys

        for (const key of keys) {
            let point = col_anchor.clone()
            for (const r of rotations) {
                point.rotate(r.angle, r.origin)
            }
            if (key.rotate) {
                point.r += key.rotate
            }
            point.meta = key
            points[key.name] = point
            col_anchor.y += key.padding
        }

        first_col = false
    }

    return points
}

exports.parse = (config = {}) => {

    a.detect_unexpected(config, 'points', ['zones', 'key', 'rotate', 'mirror'])

    let points = {}

    // getting original points

    const zones = a.sane(config.zones || {}, 'points.zones', 'object')
    const global_key = a.sane(config.key || {}, 'points.key', 'object')
    for (let [zone_name, zone] of Object.entries(zones)) {

        // handle zone-level `extends` clauses
        zone = a.inherit('points.zones', zone_name, zones)

        const anchor = a.anchor(zone.anchor || {}, `points.zones.${zone_name}.anchor`, points)
        const new_points = render_zone(zone_name, zone, anchor, global_key)
        for (const new_key of Object.keys(new_points)) {
            if (Object.keys(points).includes(new_key)) {
                throw new Error(`Key "${new_key}" defined more than once!`)
            }
        }
        points = Object.assign(points, new_points)
    }

    // applying global rotation

    if (config.rotate !== undefined) {
        const r = a.sane(config.rotate || 0, 'points.rotate', 'number')
        for (const p of Object.values(points)) {
            p.rotate(config.rotate)
        }
    }

    // mirroring

    if (config.mirror !== undefined) {
        const mirror = a.sane(config.mirror || {}, 'points.mirror', 'object')
        let axis = mirror.axis
        if (axis === undefined) {
            const distance = a.sane(mirror.distance || 0, 'points.mirror.distance', 'number')
            delete mirror.distance
            axis = a.anchor(mirror, 'points.mirror', points).x
            axis += distance / 2
        } else {
            axis = a.sane(axis || 0, 'points.mirror.axis', 'number')
        }
        const mirrored_points = {}
        for (const [name, p] of Object.entries(points)) {
            if (p.meta.asym == 'left') continue
            const mp = p.clone().mirror(axis)
            mp.meta = a.extend(mp.meta, mp.meta.mirror || {})
            mp.meta.mirrored = true
            p.meta.mirrored = false
            const new_name = `mirror_${name}`
            mp.meta.name = new_name
            mp.meta.colrow = `mirror_${mp.meta.colrow}`
            mirrored_points[new_name] = mp
            if (p.meta.asym == 'right') {
                p.meta.skip = true
            }
        }
        Object.assign(points, mirrored_points)
    }

    // removing temporary points
    
    const filtered = {}
    for (const [k, p] of Object.entries(points)) {
        if (p.meta.skip) continue
        filtered[k] = p
    }

    return filtered
}

exports.position = (points, shape) => {
    const shapes = {}
    for (const [pname, p] of Object.entries(points)) {
        shapes[pname] = p.position(u.deepcopy(shape))
    }
    return {models: shapes}
}