/**
 * tipoMuestraRoutes.js
 * Rutas para el CRUD de Tipos de Muestra.
 * Montar en app.js como: app.use('/tipo-muestra', require('./routes/tipoMuestraRoutes'));
 */

const router          = require('express').Router();
const ctrl            = require('../controllers/insumoController');
const { verifyToken } = require('../middlewares/authMiddleware');

router.get   ('/',    verifyToken, ctrl.getTiposMuestra);
router.post  ('/',    verifyToken, ctrl.crearTipoMuestra);
router.delete('/:id', verifyToken, ctrl.eliminarTipoMuestra);

module.exports = router;