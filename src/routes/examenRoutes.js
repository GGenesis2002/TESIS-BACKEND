const express = require('express');
const router = express.Router();
const examenCtrl = require('../controllers/examenController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');


// Listados
router.get('/', verifyToken, examenCtrl.listarActivos);
router.get('/inactivos', verifyToken, examenCtrl.listarInactivos);

// Operaciones
router.post('/', verifyToken, examenCtrl.crear);
router.get('/:id', verifyToken, examenCtrl.obtenerPorId);
router.put('/:id', verifyToken, examenCtrl.actualizar);
router.patch('/:id/reactivar', verifyToken, examenCtrl.reactivar);
router.delete('/:id', verifyToken, examenCtrl.desactivar);

module.exports = router;