const express = require('express');
const router = express.Router();
const notificacionController = require('../controllers/notificacionController');
const { verifyToken } = require('../middlewares/authMiddleware');

// Obtener todas las notificaciones del usuario en sesión filtradas por rol activo
router.get('/', verifyToken, notificacionController.listarMisNotificaciones);

// Marcar una notificación específica como leída
router.put('/:id/leer', verifyToken, notificacionController.leerNotificacion);

// NUEVO: Ruta para eliminar notificaciones (Resuelve por completo tus errores 404)
router.delete('/:id', verifyToken, notificacionController.eliminarNotificacion);

module.exports = router;