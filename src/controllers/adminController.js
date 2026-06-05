const pool = require('../config/db');
const fs = require('fs');
const path = require('path');
const { registrarAuditoria } = require('../helpers/auditoria');

const adminController = {
    obtenerPerfil: async (req, res) => {
        try {
            const query = `
                SELECT u.nombres, u.apellidos, u.correo, u.username, 
                       a.cargo, a.firma_digital, a.observacion
                FROM usuario u
                JOIN administrador a ON u.id_usuario = a.id_usuario
                WHERE u.id_usuario = $1`;
            const { rows } = await pool.query(query, [req.user.id]);
            res.json(rows[0]);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    },

    actualizarPerfil: async (req, res) => {
        const client = await pool.connect();
        try {
            const { nombres, apellidos, correo, cargo, observacion } = req.body;
            let nuevaFirma = req.file ? req.file.filename : null;

            await client.query('BEGIN');

            // 1. Actualizar tabla Usuario
            await client.query(`
                UPDATE usuario 
                SET nombres = $1, apellidos = $2, correo = $3 
                WHERE id_usuario = $4`, 
                [nombres, apellidos, correo, req.user.id]
            );

            // 2. Manejar la Firma Anterior (Si se sube una nueva, borrar la vieja)
            if (nuevaFirma) {
                const resFirma = await client.query('SELECT firma_digital FROM administrador WHERE id_usuario = $1', [req.user.id]);
                const firmaAntigua = resFirma.rows[0].firma_digital;

                if (firmaAntigua) {
                    const pathViejo = path.join(__dirname, `../../storage/firmas/${firmaAntigua}`);
                    if (fs.existsSync(pathViejo)) fs.unlinkSync(pathViejo);
                }

                // Actualizar con nueva firma
                await client.query(`
                    UPDATE administrador 
                    SET cargo = $1, observacion = $2, firma_digital = $3 
                    WHERE id_usuario = $4`, 
                    [cargo, observacion, nuevaFirma, req.user.id]
                );
            } else {
                // Actualizar solo texto
                await client.query(`
                    UPDATE administrador 
                    SET cargo = $1, observacion = $2 
                    WHERE id_usuario = $3`, 
                    [cargo, observacion, req.user.id]
                );
            }
  
            await client.query('COMMIT');
            res.json({ msg: "Perfil actualizado correctamente", firma: nuevaFirma });
      await registrarAuditoria(
            pool,           // ← o client si estás dentro de un BEGIN/COMMIT
            req.user.id,
            req.user.id_usuario_rol,
            'SE ACTUALIZO_PERFIL_ADMIN',
            'Actualizó su perfil de administrador'
        );
        } catch (e) {
            await client.query('ROLLBACK');
            res.status(500).json({ error: e.message });
        } finally {
            client.release();
        }
    }
};

module.exports = adminController;