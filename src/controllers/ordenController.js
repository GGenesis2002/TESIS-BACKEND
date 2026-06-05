const ordenModule = require('../modules/ordenModule');
const QRCode = require('qrcode');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { getConfig } = require('./configuracionController');
const { registrarAuditoria } = require('../helpers/auditoria');

const ordenController = {
    // 1. PACIENTE / SECRETARIA: Crea una orden
    crearPorPaciente: async (req, res) => {
        try {
            const cfg = await getConfig();
            const { id_paciente, examenes } = req.body;

            // ── Validaciones de entrada ──────────────────────────────────────
            if (!id_paciente) {
                return res.status(400).json({ error: "El id_paciente es requerido." });
            }
            if (!examenes || !Array.isArray(examenes) || examenes.length === 0) {
                return res.status(400).json({ error: "Debe enviar al menos un examen." });
            }

            // ✅ FIX: validar que cada elemento tenga id_examen y precio (objetos, no números planos)
            const examenesValidos = examenes.every(
                e => e != null && typeof e === 'object' && e.id_examen != null && e.precio != null
            );
            if (!examenesValidos) {
                return res.status(400).json({
                    error: "Formato de exámenes incorrecto. Cada examen debe ser { id_examen, precio }."
                });
            }

            // ── Crear la orden ───────────────────────────────────────────────
            const { tokenQR, ticket } = await ordenModule.crear(
                id_paciente,
                null,           // id_secretaria (null cuando la crea el paciente)
                examenes,       // array de { id_examen, precio }
                'Generada',
                cfg.expiracionQR
            );
            
            const qrImg = await QRCode.toDataURL(tokenQR);
            res.json({ ticket, qr: qrImg, msg: `QR válido por ${cfg.expiracionQR} hora(s)` });

            // Auditoría
            await registrarAuditoria(
                pool,
                req.user.id,
                req.user.id_usuario_rol,
                'SE CREO_ORDEN',
                `Orden creada para paciente ID ${id_paciente} con exámenes: ${JSON.stringify(examenes)}`
             );
        } catch (e) { 
            res.status(500).json({ error: e.message }); 
        }
    },

    // 2. SECRETARIA: Busca por Ticket o Escanea QR
    buscarOrden: async (req, res) => {
        const { filtro } = req.body;
        try {
            let id_orden;
            let ticketBusqueda = filtro;

            // Si es un string largo, asumimos que es el JWT del QR
            if (filtro.length > 50) { 
                try {
                    const decodificado = jwt.verify(filtro, process.env.JWT_SECRET);
                    id_orden = decodificado.id_orden;
                } catch (jwtError) {
                    if (jwtError.name === 'TokenExpiredError') {
                        return res.status(410).json({ 
                            error: "EXPIRED_QR", 
                            message: "El código QR ha expirado. Busque la orden por número de ticket o regenere el QR." 
                        });
                    }
                    return res.status(401).json({ error: "QR_INVALIDO", message: "Código QR inválido o alterado." });
                }
            }

            // Búsqueda en base de datos
            let query = `
                SELECT o.*, u.nombres, u.apellidos, u.cedula
                FROM orden_medica o
                JOIN paciente p ON o.id_paciente = p.id_paciente
                JOIN usuario u ON p.id_usuario = u.id_usuario
            `;
            const params = [];

            if (id_orden) {
                query += " WHERE o.id_orden = $1";
                params.push(id_orden);
            } else {
                query += " WHERE o.numero_ticket = $1";
                params.push(ticketBusqueda);
            }

            const { rows } = await pool.query(query, params);
            if (rows.length === 0) {
                return res.status(404).json({ error: "No se encontró la orden médica." });
            }

            // Traer exámenes asignados con precio
            const examenes = await pool.query(
                `SELECT e.id_examen, e.nombre_examen, d.subtotal
                 FROM detalle_orden d 
                 JOIN examen e ON d.id_examen = e.id_examen 
                 WHERE d.id_orden = $1`, [rows[0].id_orden]
            );

            res.json({ orden: rows[0], examenes: examenes.rows });

        } catch (e) { 
            res.status(500).json({ error: e.message }); 
        }
    },

    // 3. SECRETARIA: Regenerar QR de una orden
    regenerarQR: async (req, res) => {
        try {
            const { id_orden } = req.body;
            const cfg = await getConfig();

            const ordenRes = await pool.query(
                'SELECT numero_ticket FROM orden_medica WHERE id_orden = $1', [id_orden]
            );
            if (ordenRes.rows.length === 0) {
                return res.status(404).json({ error: "Orden no encontrada" });
            }
            
            const ticket = ordenRes.rows[0].numero_ticket;

            const nuevoTokenQR = jwt.sign(
                { id_orden, ticket }, 
                process.env.JWT_SECRET, 
                { expiresIn: `${cfg.expiracionQR}h` }
            );

            // ✅ FIX: la columna en BD es qr_codigo, no token_qr
            await pool.query(
                'UPDATE orden_medica SET qr_codigo = $1 WHERE id_orden = $2',
                [nuevoTokenQR, id_orden]
            );

            const qrImg = await QRCode.toDataURL(nuevoTokenQR);
            res.json({ msg: "QR Actualizado con éxito", qr: qrImg, ticket });
            //Auditoría
            await registrarAuditoria(
                pool,
                req.user.id,
                req.user.id_usuario_rol,
                'SE REGENERO_QR',
                `Regeneró QR para la orden ID ${id_orden} con ticket ${ticket}`
             );

        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    },

    // 4. SECRETARIA: Corrige los exámenes de una orden
    corregirOrden: async (req, res) => {
        try {
            const { id_orden, examenes } = req.body;

            // ✅ FIX: validar estructura antes de pasar al módulo
            if (!examenes || !Array.isArray(examenes) || examenes.length === 0) {
                return res.status(400).json({ error: "Debe enviar al menos un examen." });
            }
            const examenesValidos = examenes.every(
                e => e != null && typeof e === 'object' && e.id_examen != null && e.precio != null
            );
            if (!examenesValidos) {
                return res.status(400).json({
                    error: "Formato de exámenes incorrecto. Cada examen debe ser { id_examen, precio }."
                });
            }

            const nuevoTotal = await ordenModule.corregir(id_orden, examenes);
            
           await registrarAuditoria(
                pool,           // ← o client si estás dentro de un BEGIN/COMMIT
                req.user.id,
                req.user.id_usuario_rol,
                'SE CORRIGIÓ_ORDEN',
                'SE CORRIGIO LA ORDEN ID: ' + id_orden + ' CON LOS EXAMENES: ' + JSON.stringify(examenes)
            );

            res.json({ msg: "Orden actualizada con éxito", nuevoTotal });

        } catch (e) { 
            res.status(500).json({ error: e.message }); 
        }
    },

    // 5. SECRETARIA: Registra el pago final
    pagarOrden: async (req, res) => {
        try {
            const { id_orden } = req.body;
            await pool.query(
                `UPDATE orden_medica SET estado = 'Pagada', 
                 id_secretaria = (SELECT id_secretaria FROM asistente_analista WHERE id_usuario = $1),
                 fecha_orden = CURRENT_TIMESTAMP
                 WHERE id_orden = $2`,
                [req.user.id, id_orden]
            );

        // Auditoría
            await registrarAuditoria(
            pool,           // ← o client si estás dentro de un BEGIN/COMMIT
            req.user.id,
            req.user.id_usuario_rol,
            'SE PAGO ORDEN',
            'SE PAGO LA ORDEN ID: ' + id_orden
        );
                    
            res.json({ msg: "Pago procesado. Orden lista para muestras." });

        } catch (e) { 
            res.status(500).json({ error: e.message }); 
        }
    },

  // =========================================================================
    // SOLUCIÓN DEFINITIVA: OBTENER DETALLE CON CATEGORÍAS REALES DE LA BD
    // =========================================================================
   obtenerDetalle: async (req, res) => {
        try {
            const { id } = req.params; 

            // Query definitivo: Trae el examen enlazado a su categoría correspondiente
            const query = `
                SELECT 
                    d.id_detalle,
                    d.id_orden,
                    d.id_examen,
                    d.subtotal,
                    e.nombre_examen AS nombre_examen,
                    c.nombre_categoria AS nombre_categoria
                FROM detalle_orden d
                INNER JOIN examen e ON d.id_examen = e.id_examen
                LEFT JOIN categoria_examen c ON e.id_categoria = c.id_categoria
                WHERE d.id_orden = $1
            `;
            
            const result = await pool.query(query, [id]);
            
            // Retornamos los datos al frontend
            res.json(result.rows);
        } catch (e) {
            console.error("🔴 Error crítico en obtenerDetalle SQL:", e.message);
            res.status(500).json({ error: e.message });
        }
    },
    // Cancelar la orden desde la gestión
   cancelar: async (req, res) => {
        try {
            const { id } = req.params;
            const { motivo } = req.body;
            
            // 1. Verificar el estado actual de la orden en la Base de Datos
            const verificarQuery = `SELECT estado FROM orden_medica WHERE id_orden = $1`;
            const ordenCheck = await pool.query(verificarQuery, [id]);

            if (ordenCheck.rows.length === 0) {
                return res.status(404).json({ error: "La orden especificada no existe." });
            }

            const estadoActual = ordenCheck.rows[0].estado;

            // 2. Aplicar restricción de negocio: Solo se cancela si está 'Generada'
            if (estadoActual !== 'Generada') {
                return res.status(400).json({ 
                    error: `No se puede cancelar la orden. El estado actual es '${estadoActual}' y ya cuenta con transacciones o procesos asociados.` 
                });
            }
            
            // 3. Si pasa la validación, procedemos a cancelar en el módulo
            const ordenActualizada = await ordenModule.cancelar(id, motivo);
            // Auditoría
           await registrarAuditoria(
            pool,           // ← o client si estás dentro de un BEGIN/COMMIT
            req.user.id,
            req.user.id_usuario_rol,
            'SE CANCELÓ_ORDEN',
            'SE CANCELÓ LA ORDEN ID: ' + id + ' POR EL MOTIVO: ' + motivo
        );
            res.json({ 
                success: true, 
                message: "Orden cancelada correctamente.", 
                orden: ordenActualizada 
            });
        } catch (e) {
            console.error("Error al cancelar orden:", e.message);
            res.status(500).json({ error: e.message });
        }
    },

    // 6. LISTAR por estado (dashboard) — filtrado por paciente si el rol es Paciente
   // 6. LISTAR por estado (dashboard) — filtrado por paciente si el rol es Paciente
    listar: async (req, res) => {
        try {
            const { estado } = req.query;
            const roles = req.user.roles || [];

            // ── Si el que consulta es un Paciente, solo devolver SUS órdenes ──
            if (roles.includes('Paciente')) {
                const pacRes = await pool.query(
                    'SELECT id_paciente FROM paciente WHERE id_usuario = $1',
                    [req.user.id]
                );
                if (pacRes.rowCount === 0) return res.json([]);
                const id_paciente = pacRes.rows[0].id_paciente;

                // FIX: Agregamos JOINs para traer nombres, apellidos y CÉDULA
                let q = `
                    SELECT o.id_orden, o.numero_ticket, o.fecha_orden,
                           o.estado, o.total, u.nombres, u.apellidos, u.cedula
                    FROM orden_medica o
                    JOIN paciente p ON o.id_paciente = p.id_paciente
                    JOIN usuario u ON p.id_usuario = u.id_usuario
                    WHERE o.id_paciente = $1
                `;
                const params = [id_paciente];
                if (estado) { q += ' AND o.estado = $2'; params.push(estado); }
                q += ' ORDER BY o.fecha_orden DESC';

                const { rows } = await pool.query(q, params);
                return res.json(rows);
            }
            // ─────────────────────────────────────────────────────────────────

            // ── Si es Admin/Secretaria/Laboratorista ──
            // Reemplazamos la llamada al módulo por una consulta directa con JOINs
            // para asegurar que siempre viaje la CÉDULA al frontend.
            let qGeneral = `
                SELECT o.id_orden, o.numero_ticket, o.fecha_orden, o.estado, o.total, o.id_paciente,
                       u.nombres, u.apellidos, u.cedula
                FROM orden_medica o
                JOIN paciente p ON o.id_paciente = p.id_paciente
                JOIN usuario u ON p.id_usuario = u.id_usuario
            `;
            const paramsGen = [];
            
            if (estado) { 
                qGeneral += ' WHERE o.estado = $1'; 
                paramsGen.push(estado); 
            }
            qGeneral += ' ORDER BY o.fecha_orden DESC';

            const resultGen = await pool.query(qGeneral, paramsGen);
            res.json(resultGen.rows);

        } catch (e) { 
            res.status(500).json({ error: e.message }); 
        }
    }
};

module.exports = ordenController;