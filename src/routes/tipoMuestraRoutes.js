const router = require('express').Router();
const ctrl = require('../controllers/insumoController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');
const ROLES = require('../config/roles');

// Configuración de inventario/insumos → Administrador
const INVENTARIO = [ROLES.ADMIN];

router.get   ('/',    verifyToken, ctrl.getTiposMuestra); // lectura abierta (se usa al tomar muestras)
router.post  ('/',    verifyToken, checkRole(INVENTARIO), ctrl.crearTipoMuestra);
router.delete('/:id', verifyToken, checkRole(INVENTARIO), ctrl.eliminarTipoMuestra);

module.exports = router;