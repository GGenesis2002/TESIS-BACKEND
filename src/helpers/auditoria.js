/**
 * src/helpers/auditoria.js
 */

async function registrarAuditoria(executor, id_usuario, id_usuario_rol, accion, descripcion) {
    await executor.query(
        `INSERT INTO auditoria (id_usuario, id_usuario_rol, accion, descripcion)
         VALUES ($1, $2, $3, $4)`,
        [id_usuario, id_usuario_rol || null, accion, descripcion]
    );
}

module.exports = { registrarAuditoria };