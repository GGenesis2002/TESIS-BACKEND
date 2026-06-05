const muestraModule = require('../modules/muestraModule');
const pool = require('../config/db');
const { registrarAuditoria } = require('../helpers/auditoria'); // ← NUEVO

const muestraController = {

    confirmarRecoleccion: async (req, res) => {
        try {
            const { id_orden, recipientes } = req.body;

            if (!id_orden) return res.status(400).json({ error: "Falta id_orden" });

            const { muestras, insumos, codigo_muestra } = await muestraModule.registrarToma(
                id_orden,
                recipientes || []
            );

            const userId = req.user?.id || req.user?.id_usuario;

            const resumenRecipientes = muestras
                .map(m => m.tipo_recipiente)
                .join(', ');

           await registrarAuditoria(
            pool,           // ← o client si estás dentro de un BEGIN/COMMIT
            req.user.id,
            req.user.id_usuario_rol,
            'REGISTRO_RECOLECCION',
            'Se registró la recolección de muestras para la orden ID: ' + id_orden + '. Recipientes: ' + resumenRecipientes
        );

            res.status(201).json({
                msg: "Muestras registradas. Orden en proceso.",
                instruccion: "Escriba el código en cada recipiente con marcador permanente",
                codigo_a_escribir: codigo_muestra,
                muestras_registradas: muestras,
                insumos_descontados: insumos,
            });

        } catch (e) {
            console.error("Error confirmarRecoleccion:", e.message);
            const status = (
                e.message.includes("Stock insuficiente") ||
                e.message.includes("ya se procesó")
            ) ? 400 : 500;
            res.status(status).json({ error: e.message });
        }
    },

    obtenerInsumos: async (req, res) => {
        try {
            const { id_orden } = req.params;
            const insumos = await muestraModule.obtenerInsumosPorOrden(id_orden);

            const mapaInsumos = {};
            for (const ins of insumos) {
                const key = ins.id_insumo;
                if (!mapaInsumos[key]) {
                    mapaInsumos[key] = {
                        id_insumo:           ins.id_insumo,
                        nombre_insumo:       ins.insumo,
                        tipo_recipiente:     ins.insumo,
                        id_tipo_muestra:     ins.id_tipo_muestra || null,
                        tipo_muestra_nombre: ins.tipo_muestra_nombre || null,
                        id_categoria_examen: ins.id_categoria_examen || null,
                        categoria_examen:    ins.categoria_examen || 'Sin categoría',
                        examenes:            [],
                    };
                }
                if (ins.examenes) {
                    ins.examenes.split(', ').forEach(ex => {
                        if (!mapaInsumos[key].examenes.includes(ex)) {
                            mapaInsumos[key].examenes.push(ex);
                        }
                    });
                }
            }
            const recipientes_auto = Object.values(mapaInsumos);

            const mapaCategorias = {};
            for (const rec of recipientes_auto) {
                const catKey = rec.id_categoria_examen ?? 'sin_cat';
                if (!mapaCategorias[catKey]) {
                    mapaCategorias[catKey] = {
                        id_categoria: rec.id_categoria_examen,
                        nombre:       rec.categoria_examen,
                        examenes:     [],
                        recipientes:  [],
                    };
                }
                rec.examenes.forEach(ex => {
                    if (!mapaCategorias[catKey].examenes.includes(ex))
                        mapaCategorias[catKey].examenes.push(ex);
                });
                mapaCategorias[catKey].recipientes.push({
                    id_insumo:           rec.id_insumo,
                    nombre_insumo:       rec.nombre_insumo,
                    tipo_recipiente:     rec.tipo_recipiente,
                    id_tipo_muestra:     rec.id_tipo_muestra,
                    tipo_muestra_nombre: rec.tipo_muestra_nombre,
                });
            }

            res.json({
                insumos,
                recipientes_auto,
                categorias: Object.values(mapaCategorias),
            });
        } catch (e) {
            console.error("Error obtenerInsumos:", e.message);
            res.status(500).json({ error: e.message });
        }
    },

    // GET /muestras/historial
    obtenerHistorialMuestras: async (req, res) => {
        try {
            const lista = await muestraModule.obtenerHistorialMuestras();
            res.json(lista);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    },

    buscarPorMarcadoManual: async (req, res) => {
        try {
            const { codigo } = req.params;

            const query = `
                SELECT
                    m.*,
                    u.nombres                                           AS paciente_nombres,
                    u.apellidos                                         AS paciente_apellidos,
                    o.numero_ticket,
                    o.estado                                            AS estado_orden,
                    tm_directo.nombre                                   AS tipo_muestra_nombre,
                    (
                        SELECT json_agg(sub)
                        FROM (
                            SELECT DISTINCT
                                e2.nombre_examen    AS examen,
                                i2.nombre           AS insumo,
                                ei2.cantidad_usada  AS cantidad,
                                i2.unidad_medida    AS unidad
                            FROM detalle_orden   do2
                            JOIN examen          e2  ON do2.id_examen    = e2.id_examen
                            LEFT JOIN examen_insumo ei2 ON e2.id_examen  = ei2.id_examen
                            LEFT JOIN insumos       i2  ON ei2.id_insumo = i2.id_insumo
                            WHERE do2.id_orden = o.id_orden
                              AND e2.nombre_examen IS NOT NULL
                        ) sub
                    )                                                   AS insumos_usados
                FROM muestra m
                JOIN orden_medica   o             ON m.id_orden        = o.id_orden
                JOIN paciente       p             ON o.id_paciente     = p.id_paciente
                JOIN usuario        u             ON p.id_usuario      = u.id_usuario
                LEFT JOIN tipo_muestra tm_directo ON m.id_tipo_muestra = tm_directo.id_tipo_muestra
                WHERE m.codigo_muestra = $1
                ORDER BY m.id_muestra ASC
            `;

            const { rows } = await pool.query(query, [codigo.toUpperCase()]);

            if (rows.length === 0)
                return res.status(404).json({ msg: "No existe muestra con ese código" });

            res.json(rows);

        } catch (e) {
            console.error("Error buscarPorMarcadoManual:", e.message);
            res.status(500).json({ error: e.message });
        }
    },
};

module.exports = muestraController;