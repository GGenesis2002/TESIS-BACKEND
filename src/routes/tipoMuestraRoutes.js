

const router          = require('express').Router();
const ctrl            = require('../controllers/insumoController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');

router.get   ('/',    verifyToken, ctrl.getTiposMuestra);
router.post  ('/',    verifyToken, ctrl.crearTipoMuestra);
router.delete('/:id', verifyToken, ctrl.eliminarTipoMuestra);

module.exports = router;