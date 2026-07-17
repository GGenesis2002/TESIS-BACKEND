const ordenModule = require('../modules/ordenModule');
const QRCode = require('qrcode');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { getConfig } = require('./configuracionController');
const { registrarAuditoria } = require('../helpers/auditoria');

// ─── Resuelve el ROL ACTIVO de la sesión (no todos los roles de la cuenta) ───
// Una cuenta puede tener varios roles (Administrador + Paciente, por ejemplo).
// req.user.roles trae TODOS esos roles, así que nunca sirve para saber con
// cuál perfil se inició sesión ahora. El rol activo real viaja en el header
// x-id-usuario-rol (ver authMiddleware), y aquí lo traducimos a su nombre.
//
// Fallback: si el cliente no mandó el header (apps viejas) pero la cuenta
// solo tiene un rol, usamos ese único rol para no romper compatibilidad.
const resolverRolActivo = async (req) => {
    const idUsuarioRol = req.user.id_usuario_rol;

    if (idUsuarioRol) {
        const { rows } = await pool.query(
            `SELECT r.nombre
             FROM usuario_rol ur
             JOIN rol r ON ur.id_rol = r.id_rol
             WHERE ur.id_usuario_rol = $1`,
            [idUsuarioRol]
        );
        if (rows.length > 0) return rows[0].nombre;
    }

    const rolesCuenta = req.user.roles || [];
    if (rolesCuenta.length === 1) return rolesCuenta[0];

    return null; // Ambiguo: varios roles y sin header -> no se puede determinar
};

const ordenController = {
    // 1. PACIENTE / SECRETARIA: Crea una orden
   crearPorPaciente: async (req, res) => {
        console.log('>>> ROLES EN TOKEN:', req.user.roles); // ← AGREGA ESTO
    console.log('>>> USUARIO ID:', req.user.id);
    try {
        const cfg = await getConfig();
        const { examenes, id_paciente: idPacienteBody } = req.body;
        const rolActivo = await resolverRolActivo(req);

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

        let id_paciente;

        if (rolActivo === 'Paciente') {
            // ✅ Paciente: ignorar lo que manda el cliente, resolver desde el JWT
            const pacRes = await pool.query(
                'SELECT id_paciente FROM paciente WHERE id_usuario = $1',
                [req.user.id]
            );
            if (pacRes.rowCount === 0) {
                return res.status(403).json({ error: "No se encontró el paciente asociado a este usuario." });
            }
            id_paciente = pacRes.rows[0].id_paciente;

        } else if (
    ['Secretaria', 'Administrador', 'Técnico', 'Especialista', 'Asistente Analista'].includes(rolActivo)
) {
            // ✅ Secretaria/Admin: usa el id_paciente que manda el body (es para otro paciente)
            if (!idPacienteBody) {
                return res.status(400).json({ error: "El id_paciente es requerido." });
            }
            id_paciente = idPacienteBody;
        } else {
            return res.status(403).json({ error: "No tienes permiso para crear órdenes." });
        }

        const { tokenQR, ticket } = await ordenModule.crear(
            id_paciente,
            null,
            examenes,
            'Generada',
            cfg.expiracionQR
        );

        const qrImg = await QRCode.toDataURL(tokenQR);
        res.json({ ticket, qr: qrImg, msg: `QR válido por ${cfg.expiracionQR} hora(s)` });

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
    // 1b. PACIENTE: Edita su propia orden (solo estado 'Generada')
    editarPorPaciente: async (req, res) => {
        try {
            const { id } = req.params;
            const { examenes } = req.body;

            // Validar examenes
            if (!examenes || !Array.isArray(examenes) || examenes.length === 0) {
                return res.status(400).json({ error: 'Debe enviar al menos un examen.' });
            }
            const examenesValidos = examenes.every(
                e => e != null && typeof e === 'object' && e.id_examen != null && e.precio != null
            );
            if (!examenesValidos) {
                return res.status(400).json({
                    error: 'Formato de exámenes incorrecto. Cada examen debe ser { id_examen, precio }.'
                });
            }

            // Verificar que la orden pertenece al paciente autenticado
            const pacRes = await pool.query(
                'SELECT id_paciente FROM paciente WHERE id_usuario = $1',
                [req.user.id]
            );
            if (pacRes.rowCount === 0) {
                return res.status(403).json({ error: 'Paciente no encontrado.' });
            }
            const id_paciente = pacRes.rows[0].id_paciente;

            const ordenRes = await pool.query(
                'SELECT estado, id_paciente FROM orden_medica WHERE id_orden = $1',
                [id]
            );
            if (ordenRes.rowCount === 0) {
                return res.status(404).json({ error: 'Orden no encontrada.' });
            }

            const orden = ordenRes.rows[0];

            // Solo puede editar sus propias ordenes
            if (orden.id_paciente !== id_paciente) {
                return res.status(403).json({ error: 'No tienes permiso para editar esta orden.' });
            }

            // Solo si esta en estado 'Generada'
            if (orden.estado !== 'Generada') {
                return res.status(400).json({
                    error: `No se puede editar la orden. Estado actual: '${orden.estado}'.`
                });
            }

            // Usar corregir: limpia detalles y reinserta
            const nuevoTotal = await ordenModule.corregir(id, examenes);

            await registrarAuditoria(
                pool,
                req.user.id,
                req.user.id_usuario_rol,
                'SE EDITO_ORDEN_PACIENTE',
                `Paciente edito la orden ID: ${id} con examenes: ${JSON.stringify(examenes)}`
            );

            res.json({ msg: 'Orden actualizada con exito', nuevoTotal, id_orden: parseInt(id) });
        } catch (e) {
            console.error('Error al editar orden por paciente:', e.message);
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
            const rolActivo = await resolverRolActivo(req);

            // ── Si el que consulta es un Paciente, solo devolver SUS órdenes ──
            if (rolActivo === 'Paciente') {
                const pacRes = await pool.query(
                    'SELECT id_paciente FROM paciente WHERE id_usuario = $1',
                    [req.user.id]
                );
                if (pacRes.rowCount === 0) return res.json([]);
                const id_paciente = pacRes.rows[0].id_paciente;

                // FIX: Agregamos JOINs para traer nombres, apellidos y CÉDULA
                // En listar(), dentro del bloque if (roles.includes('Paciente')):
                    let q = `
                        SELECT o.id_orden, o.numero_ticket, o.fecha_orden,
                            o.estado, o.total, o.qr_codigo,
                            u.nombres, u.apellidos, u.cedula,
                            CONCAT(u.nombres, ' ', u.apellidos) AS paciente,
                            (SELECT COUNT(*) FROM detalle_orden do2 WHERE do2.id_orden = o.id_orden) AS total_examenes
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
                       u.nombres, u.apellidos, u.cedula,
                       CONCAT(u.nombres, ' ', u.apellidos) AS paciente,
                       (SELECT COUNT(*) FROM detalle_orden do2 WHERE do2.id_orden = o.id_orden) AS total_examenes
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
    },

    // 7. ADMIN/SECRETARIA: Eliminar una orden permanentemente
    eliminar: async (req, res) => {
        try {
            const { id } = req.params;

            // 1. Verificar que la orden existe
            const check = await pool.query(
                'SELECT estado, id_paciente FROM orden_medica WHERE id_orden = $1', [id]
            );
            if (check.rows.length === 0) {
                return res.status(404).json({ error: "La orden especificada no existe." });
            }

            const estadoActual = check.rows[0].estado;
            const rolActivo = await resolverRolActivo(req);

            // 2. Si es Paciente, solo puede eliminar sus propias órdenes
            if (rolActivo === 'Paciente') {
                const pacRes = await pool.query(
                    'SELECT id_paciente FROM paciente WHERE id_usuario = $1',
                    [req.user.id]
                );
                if (pacRes.rowCount === 0) {
                    return res.status(403).json({ error: 'Paciente no encontrado.' });
                }
                if (check.rows[0].id_paciente !== pacRes.rows[0].id_paciente) {
                    return res.status(403).json({ error: 'No tienes permiso para eliminar esta orden.' });
                }
            }

            // 3. Solo se pueden eliminar órdenes Canceladas o Generadas (sin transacciones financieras)
            const estadosPermitidos = ['Generada', 'Cancelada'];
            if (!estadosPermitidos.includes(estadoActual)) {
                return res.status(400).json({
                    error: `No se puede eliminar la orden. Solo se pueden eliminar órdenes en estado 'Generada' o 'Cancelada'. Estado actual: '${estadoActual}'.`
                });
            }

            // 3. Eliminar detalle primero (FK) y luego la orden
            await pool.query('DELETE FROM detalle_orden WHERE id_orden = $1', [id]);
            await pool.query('DELETE FROM orden_medica WHERE id_orden = $1', [id]);

            // Auditoría
            await registrarAuditoria(
                pool,
                req.user.id,
                req.user.id_usuario_rol,
                'SE ELIMINÓ_ORDEN',
                `Se eliminó permanentemente la orden ID: ${id} (estado previo: ${estadoActual})`
            );

            res.json({ success: true, message: "Orden eliminada permanentemente." });
        } catch (e) {
            console.error("Error al eliminar orden:", e.message);
            res.status(500).json({ error: e.message });
        }
    }
};  // ← fin ordenController

// ─── LIMPIEZA AUTOMÁTICA: eliminar órdenes 'Generada' con más de 5 días ──────
// Se ejecuta una vez al iniciar el servidor y luego cada 24 horas.
const limpiarOrdenesExpiradas = async () => {
    try {
        // Primero eliminar los detalles de las órdenes expiradas
        await pool.query(`
            DELETE FROM detalle_orden
            WHERE id_orden IN (
                SELECT id_orden FROM orden_medica
                WHERE estado = 'Generada'
                  AND fecha_orden < NOW() - INTERVAL '5 days'
            )
        `);

        // Luego eliminar las órdenes expiradas
        const result = await pool.query(`
            DELETE FROM orden_medica
            WHERE estado = 'Generada' 
              AND fecha_orden < NOW() - INTERVAL '5 days'
            RETURNING id_orden, numero_ticket
        `);

        
        if (result.rowCount > 0) {
            console.log(`[LIMPIEZA AUTOMÁTICA] Se eliminaron ${result.rowCount} orden(es) expirada(s):`,
                result.rows.map(r => r.numero_ticket).join(', '));

            // Auditoría: un registro por cada orden eliminada
            for (const orden of result.rows) {
                await registrarAuditoria(
                    pool,
                    null,                  // proceso automático del sistema, no hay usuario real
                    null,                  // no hay rol de usuario real en un proceso automático
                    'ELIMINACION_AUTOMATICA_ORDEN',
                    `Se eliminó automáticamente por expiración la orden ID: ${orden.id_orden} (ticket: ${orden.numero_ticket}, estado previo: Generada)`
                );
            }
        }

    } catch (e) {
        console.error("[LIMPIEZA AUTOMÁTICA] Error al limpiar órdenes expiradas:", e.message);
    }
};

// Ejecutar al iniciar y luego cada 24 horas
limpiarOrdenesExpiradas();
setInterval(limpiarOrdenesExpiradas, 24 * 60 * 60 * 1000);

module.exports = ordenController;