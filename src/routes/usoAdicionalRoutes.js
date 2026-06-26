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

// Analista registra un uso extra
router.post('/', verifyToken, ctrl.registrar);

// Admin lista todos los usos adicionales (pendientes e historial)
router.get('/', verifyToken, ctrl.listar);

// Admin aprueba → descuenta stock
router.post('/:id/aprobar', verifyToken, ctrl.aprobar);

// Admin rechaza → no descuenta
router.post('/:id/rechazar', verifyToken, ctrl.rechazar);

module.exports = router;
