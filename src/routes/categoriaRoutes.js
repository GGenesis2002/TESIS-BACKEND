const express = require('express');
const router = express.Router();
const catCtrl = require('../controllers/categoriaController');
// CORRECCIÓN: Agrega las llaves para extraer solo la función verifyToken
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');

// Listados
router.get('/', verifyToken, catCtrl.listarActivas);
router.get('/inactivas', verifyToken, catCtrl.listarInactivas);

// Operaciones
router.post('/', verifyToken, catCtrl.crear);
router.get('/:id', verifyToken, catCtrl.obtenerPorId);
router.put('/:id', verifyToken, catCtrl.actualizar);
router.patch('/:id/reactivar', verifyToken, catCtrl.reactivar); // Reactivación parcial
router.delete('/:id', verifyToken, catCtrl.desactivar); // Eliminar (Lógico)

module.exports = router;