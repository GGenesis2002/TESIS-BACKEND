const pool = require('../config/db');
const Usuario = require('../modules/usuarioModule');
const bcrypt = require('bcryptjs');
const { registrarAuditoria } = require('../helpers/auditoria'); // ← NUEVO

const usuarioController = {

    listarUsuarios: async (req, res) => {
        try {
            const data = await Usuario.getAll();
            res.json(data);
        } catch (e) { res.status(500).json({ error: e.message }); }
    },

    // 1. Cambiar contraseña
    actualizarPassword: async (req, res) => {
        const client = await pool.connect();
        try {
            const { actual, nueva } = req.body;
            const userRes = await pool.query('SELECT password FROM usuario WHERE id_usuario = $1', [req.user.id]);
            
            if (!(await bcrypt.compare(actual, userRes.rows[0].password))) {
                return res.status(401).json({ msg: "Contraseña actual incorrecta" });
            }

            await client.query('BEGIN');

            const hash = await bcrypt.hash(nueva, 10);
            await client.query('UPDATE usuario SET password = $1 WHERE id_usuario = $2', [hash, req.user.id]);

            // Auditoría — usa client porque estamos dentro de una transacción
            await registrarAuditoria(
                client,
                req.user.id,
                req.user.id_usuario_rol,
                'CAMBIO_PASSWORD',
                'El usuario actualizó su propia contraseña'
            );

            await client.query('COMMIT');
            res.json({ msg: "Contraseña actualizada" });
        } catch (e) { 
            await client.query('ROLLBACK');
            res.status(500).json({ error: e.message }); 
        } finally {
            client.release();
        }
    },

    // 2. Activar/Desactivar cuenta
    toggleEstado: async (req, res) => {
        try {
            const result = await Usuario.updateStatus(req.params.id);
            
            // Auditoría — usa pool porque no hay transacción abierta
            await registrarAuditoria(
                pool,
                req.user.id,
                req.user.id_usuario_rol,
                'ESTADO_USUARIO',
                `Cambio de estado del usuario ID: ${req.params.id}`
            );
            
            res.json({ msg: "Estado actualizado", nuevoEstado: result.estado });
        } catch (e) { res.status(500).json({ error: e.message }); }
    }
};

module.exports = usuarioController;