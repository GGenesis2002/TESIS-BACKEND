/**
 * usoAdicionalRoutes.js
 *
 * Registrar en app.js / index.js:
 *   const usoAdicionalRoutes = require('./routes/usoAdicionalRoutes');
 *   app.use('/api/usos-adicionales', usoAdicionalRoutes);
 */

const router = require('express').Router();
const ctrl   = require('../controllers/usoAdicionalController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');
const ROLES = require('../config/roles');

const ADMIN_ONLY = [ROLES.ADMIN];
const ASISTENTE_ONLY = [ROLES.ASISTENTE];

// Analista registra un uso extra
router.post('/', verifyToken, checkRole(ASISTENTE_ONLY), ctrl.registrar);

// Admin lista todos los usos adicionales (pendientes e historial)
router.get('/', verifyToken,checkRole(ADMIN_ONLY), ctrl.listar);

// Admin aprueba → descuenta stock
router.post('/:id/aprobar', verifyToken,checkRole(ADMIN_ONLY), ctrl.aprobar);

// Admin rechaza → no descuenta
router.post('/:id/rechazar', verifyToken,checkRole(ADMIN_ONLY), ctrl.rechazar);

module.exports = router;
