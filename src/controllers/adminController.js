const pool = require('../config/db');
const supabase = require('../config/supabaseStorage');
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
        const perfil = rows[0];

        // Si tiene firma, generar URL firmada válida por 1 hora
        if (perfil?.firma_digital) {
            const { data, error } = await supabase.storage
                .from('firmas')
                .createSignedUrl(perfil.firma_digital, 3600);
            
            if (!error) perfil.firma_url = data.signedUrl;
        }

        res.json(perfil);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
},

    actualizarPerfil: async (req, res) => {
        const client = await pool.connect();
        try {
            const { nombres, apellidos, correo, cargo, observacion } = req.body;
            let nuevaFirmaPath = null;

            await client.query('BEGIN');

            // 1. Actualizar tabla Usuario
            await client.query(`
                UPDATE usuario 
                SET nombres = $1, apellidos = $2, correo = $3 
                WHERE id_usuario = $4`, 
                [nombres, apellidos, correo, req.user.id]
            );

            // 2. Si se sube nueva firma → subir a Supabase Storage
            if (req.file) {
                // Borrar firma anterior de Supabase si existe
                const resFirma = await client.query(
                    'SELECT firma_digital FROM administrador WHERE id_usuario = $1', 
                    [req.user.id]
                );
                const firmaAntigua = resFirma.rows[0]?.firma_digital;
                if (firmaAntigua) {
                    await supabase.storage.from('firmas').remove([firmaAntigua]);
                }

                // Subir nueva firma
                const extension = req.file.mimetype === 'image/png' ? 'png' : 'jpg';
                nuevaFirmaPath = `firma-${req.user.id}-${Date.now()}.${extension}`;

                const { error: uploadError } = await supabase.storage
                    .from('firmas')
                    .upload(nuevaFirmaPath, req.file.buffer, {
                        contentType: req.file.mimetype,
                        upsert: true
                    });

                if (uploadError) throw new Error('Error subiendo firma: ' + uploadError.message);

                // Actualizar con nueva firma
                await client.query(`
                    UPDATE administrador 
                    SET cargo = $1, observacion = $2, firma_digital = $3 
                    WHERE id_usuario = $4`, 
                    [cargo, observacion, nuevaFirmaPath, req.user.id]
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

            await registrarAuditoria(
                client,
                req.user.id,
                req.user.id_usuario_rol,
                'SE ACTUALIZO_PERFIL_ADMIN',
                'Actualizó su perfil de administrador'
            );

            await client.query('COMMIT');

            // Generar URL firmada para devolver al frontend
            let firmaUrl = null;
            if (nuevaFirmaPath) {
                const { data: signedData } = await supabase.storage
                    .from('firmas')
                    .createSignedUrl(nuevaFirmaPath, 3600);
                firmaUrl = signedData?.signedUrl || null;
            }

            res.json({
                msg:      "Perfil actualizado correctamente",
                firma:    nuevaFirmaPath,  // path (para la BD)
                firma_url: firmaUrl,       // URL firmada (para el frontend)
            });

        } catch (e) {
            await client.query('ROLLBACK');
            res.status(500).json({ error: e.message });
        } finally {
            client.release();
        }
    }
};

module.exports = adminController;