const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');
const ROLES = require('../config/roles');

const FINANZAS = [ROLES.ADMIN, ROLES.ASISTENTE]; // caja, pagos, órdenes del día

// ─── ESTADÍSTICAS PRINCIPALES POR ROL ────────────────────────────────────────

/**
 * @route   GET /api/dashboard/admin
 */
router.get('/admin', verifyToken, checkRole([ROLES.ADMIN]), dashboardController.getAdminStats);

/**
 * @route   GET /api/dashboard/secretaria
 */
router.get('/secretaria', verifyToken, checkRole([ROLES.ADMIN, ROLES.ASISTENTE]), dashboardController.getAsistenAnalistaStats);

/**
 * @route   GET /api/dashboard/tecnico
 */
router.get('/tecnico', verifyToken, checkRole([ROLES.ADMIN, ROLES.TECNICO]), dashboardController.getTecnicoStats);
router.get('/usuarios-inactivos', verifyToken, checkRole([ROLES.ADMIN, ROLES.TECNICO]), dashboardController.getUsuariosInactivos);

// ─── REPORTES Y FINANZAS ─────────────────────────────────────────────────────

router.get('/secretaria/reporte', verifyToken, checkRole(FINANZAS), dashboardController.descargarReporteMensual);
router.get('/arqueo-hoy', verifyToken, checkRole(FINANZAS), dashboardController.getArqueoCajaHoy);
router.get('/arqueo-por-usuario', verifyToken, checkRole(FINANZAS), dashboardController.getArqueoPorUsuario);
router.get('/cierres-caja', verifyToken, checkRole(FINANZAS), dashboardController.getCierresCaja);
router.get('/cierres-caja/:id', verifyToken, checkRole(FINANZAS), dashboardController.getDetalleCierreCaja);


// ─── ENDPOINTS DE DRILL-DOWN (DETALLES DEL DASHBOARD) ────────────────────────

router.get('/ordenes-por-usuario', verifyToken, checkRole(FINANZAS), dashboardController.getOrdenesPorUsuario);
router.get('/ingresos-por-usuario', verifyToken, checkRole(FINANZAS), dashboardController.getIngresosPorUsuario);


// ─── AUDITORÍA Y ALERTAS ─────────────────────────────────────────────────────

/**
 * @route   GET /api/dashboard/auditoria
 * @desc    Historial y bitácora → información sensible del sistema, solo Admin.
 */
router.get('/auditoria', verifyToken, checkRole([ROLES.ADMIN, ROLES.TECNICO]), dashboardController.getAuditoria);

router.get('/alertas', verifyToken, (req, res) => {
    res.redirect(307, '/api/notificaciones');
});


// ─── MODALES DE DRILL-DOWN ────────────────────────────────────────────────────

router.get('/resultados-criticos', verifyToken, checkRole([ROLES.ADMIN, ROLES.ESPECIALISTA]), dashboardController.getResultadosCriticos);
router.get('/usuarios-activos-hoy', verifyToken, checkRole([ROLES.ADMIN, ROLES.TECNICO]), dashboardController.getUsuariosActivosHoy);

module.exports = router;