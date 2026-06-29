const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');

const { verifyToken, checkRole } = require('../middlewares/authMiddleware');

// ─── ESTADÍSTICAS PRINCIPALES POR ROL ────────────────────────────────────────

/**
 * @route   GET /api/dashboard/admin
 * @desc    Obtiene las estadísticas y KPIs para el administrador
 */
router.get('/admin', verifyToken, dashboardController.getAdminStats);

/**
 * @route   GET /api/dashboard/secretaria
 * @desc    Obtiene las estadísticas para Secretaría / Asistente Analista
 */
router.get('/secretaria', verifyToken, dashboardController.getAsistenAnalistaStats);

/**
 * @route   GET /api/dashboard/tecnico
 * @desc    Obtiene métricas del sistema, estado de BD y logs para el perfil Técnico
 */
router.get('/tecnico', verifyToken, dashboardController.getTecnicoStats);


// ─── REPORTES Y FINANZAS ─────────────────────────────────────────────────────

/**
 * @route   GET /api/dashboard/secretaria/reporte
 * @desc    Descarga segura de reportes mensuales en formato CSV
 */
router.get('/secretaria/reporte', verifyToken, dashboardController.descargarReporteMensual);

/**
 * @route   GET /api/dashboard/arqueo-hoy
 * @desc    Obtiene el desglose de ingresos del día (Efectivo, Transferencia, Tarjeta)
 */
router.get('/arqueo-hoy', verifyToken, dashboardController.getArqueoCajaHoy);


// ─── ENDPOINTS DE DRILL-DOWN (DETALLES DEL DASHBOARD) ────────────────────────

/**
 * @route   GET /api/dashboard/ordenes-por-usuario
 * @desc    Devuelve las órdenes de hoy agrupadas por el usuario que las creó
 */
router.get('/ordenes-por-usuario', verifyToken, dashboardController.getOrdenesPorUsuario);

/**
 * @route   GET /api/dashboard/ingresos-por-usuario
 * @desc    Devuelve el total acumulado y cantidad de órdenes generadas hoy por usuario
 */
router.get('/ingresos-por-usuario', verifyToken, dashboardController.getIngresosPorUsuario);

// ─────────────────────────────────────────────────────────────────────────────
// GET /usuarios/activos-hoy
// Lista de usuarios que han iniciado sesión hoy (para el modal de usuarios)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @route   GET /api/dashboard/ingresos-por-usuario
 * @desc    Devuelve el total acumulado y cantidad de órdenes generadas hoy por usuario
 */
router.get('/usuarios/activos-hoy', verifyToken, dashboardController.getUsuariosActivosHoy);



// ─── AUDITORÍA Y ALERTAS ─────────────────────────────────────────────────────

/**
 * @route   GET /api/dashboard/auditoria
 * @desc    Historial y bitácora de acciones del sistema con filtro de fechas
 */
router.get('/auditoria', verifyToken, dashboardController.getAuditoria);

/**
 * @route   GET /api/dashboard/alertas
 * @desc    Redirección temporal hacia el módulo central de notificaciones
 */
router.get('/alertas', verifyToken, (req, res) => {
    res.redirect(307, '/api/notificaciones');
});

module.exports = router;