const asignacionModule = require('../modules/asignacionModule');
const pool = require('../config/db');
const { registrarAuditoria } = require('../helpers/auditoria');

const asignacionController = {
    // Vincular especialista con examen (Recibe id_usuario directamente)
    asignar: async (req, res) => {
        try {
            const { id_usuario, id_examen } = req.body;

            // 1. Buscamos el id_especialista correspondiente a ese id_usuario
            const espRes = await pool.query('SELECT id_especialista FROM especialista WHERE id_usuario = $1', [id_usuario]);
            if (espRes.rows.length === 0) {
                return res.status(404).json({ error: "El usuario no está registrado como especialista." });
            }
            const id_especialista = espRes.rows[0].id_especialista;

            // 2. Revisamos si ya existía una asignación previa inactiva para reactivarla
            const existe = await pool.query(
                'SELECT * FROM especialista_examen WHERE id_especialista = $1 AND id_examen = $2',
                [id_especialista, id_examen]
            );

            let nueva;
            if (existe.rows.length > 0) {
                const up = await pool.query(
                    'UPDATE especialista_examen SET estado = TRUE WHERE id_especialista = $1 AND id_examen = $2 RETURNING *',
                    [id_especialista, id_examen]
                );
                nueva = up.rows[0];
            } else {
                nueva = await asignacionModule.create(id_especialista, id_examen);
            }

            // Registro en Auditoría
            await registrarAuditoria(
                pool,
                req.user.id,
                req.user.id_usuario_rol,
                'SE ASIGNO_ESPECIALISTA_EXAMEN',
                `Asignó especialista ID ${id_especialista} al examen ID ${id_examen}`
            );

            res.status(201).json(nueva);
        } catch (e) { 
            res.status(500).json({ error: e.message }); 
        }
    },

    // Listado general o filtrado por especialista (?id_usuario=X)
    listar: async (req, res) => {
        try {
            const { buscar, id_usuario } = req.query;
            
            // Si pasan id_usuario, devolvemos las asignaciones de ese especialista específico
            if (id_usuario) {
                const datosIndividuales = await asignacionModule.getByUsuarioId(id_usuario);
                return res.json(datosIndividuales);
            }

            let datos;
            if (buscar) {
                datos = await asignacionModule.search(buscar);
            } else {
                datos = await asignacionModule.getAllActive();
            }
            
            res.json(datos);
        } catch (e) { 
            res.status(500).json({ error: e.message }); 
        }
    },

    // Quitar asignación de examen recibiendo los parámetros compuestos
    desasignarExamen: async (req, res) => {
        try {
            const { id_usuario, id_examen } = req.body;

            const espRes = await pool.query('SELECT id_especialista FROM especialista WHERE id_usuario = $1', [id_usuario]);
            if (espRes.rows.length === 0) return res.status(404).json({ error: "Especialista no encontrado." });
            
            const id_especialista = espRes.rows[0].id_especialista;
            await asignacionModule.deleteSpecific(id_especialista, id_examen);

            await registrarAuditoria(
                pool,
                req.user.id,
                req.user.id_usuario_rol,
                'SE QUITO_ASIGNACION_EXAMEN',
                `Eliminó examen ID ${id_examen} al especialista ID ${id_especialista}`
            );

            res.json({ msg: "Asignación removida correctamente" });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    },

    // Quitar permiso por ID único de asignación
    quitarAsignacion: async (req, res) => {
        try {
            const { id } = req.params;
            const exito = await asignacionModule.logicalDelete(id);
            if (!exito) return res.status(404).json({ msg: "Asignación no encontrada" });

            await registrarAuditoria(
                pool,
                req.user.id,
                req.user.id_usuario_rol,
                'SE QUITO_ASIGNACION_EXAMEN',
                `Eliminó asignación número: ${id}`
            );

            res.json({ msg: "Asignación deshabilitada" });
        } catch (e) { 
            res.status(500).json({ error: e.message }); 
        }
    }
};

module.exports = asignacionController;