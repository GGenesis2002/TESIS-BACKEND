const notificacionModule = require('../modules/notificacionModule');

const notificacionController = {
    // Listar notificaciones del usuario logueado según su rol activo
    listarMisNotificaciones: async (req, res) => {
        try {
            // Capturamos el rol enviado desde los interceptores de Axios del frontend
            const id_usuario_rol = req.headers['x-id-usuario-rol'] ? parseInt(req.headers['x-id-usuario-rol']) : null;

            const notificaciones = await notificacionModule.getByUser(req.user.id, id_usuario_rol);
            const totalNoLeidas = await notificacionModule.contarNoLeidas(req.user.id, id_usuario_rol);
            
            res.json({
                notificaciones,
                totalNoLeidas
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    },

    // Acción de marcar como leída
    leerNotificacion: async (req, res) => {
        try {
            const actualizada = await notificacionModule.marcarLeida(req.params.id, req.user.id);
            if (!actualizada) return res.status(404).json({ error: "Notificación no encontrada" });
            res.json(actualizada);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    },

    // NUEVO: Eliminar notificación
    eliminarNotificacion: async (req, res) => {
        try {
            const eliminado = await notificacionModule.eliminar(req.params.id, req.user.id);
            if (!eliminado) {
                return res.status(404).json({ error: "No se pudo encontrar o eliminar la notificación" });
            }
            res.json({ msg: "Notificación eliminada correctamente" });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    }
};

module.exports = notificacionController;