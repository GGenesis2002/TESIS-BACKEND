const express = require('express');
const router = express.Router();
const paramCtrl = require('../controllers/parametroController');
const {verifyToken} = require('../middlewares/authMiddleware');

// Listar parámetros de un examen específico
router.get('/examen/:id_examen', verifyToken, paramCtrl.listarPorExamen);
router.get('/examen/:id_examen/inactivos', verifyToken, paramCtrl.listarInactivosPorExamen);
// 🛠️ Listar todos los parámetros de manera global (Evita el 404 del Dashboard)
router.get('/', verifyToken, paramCtrl.listarTodos);
// Operaciones individuales
router.post('/', verifyToken, paramCtrl.crear);
router.put('/:id', verifyToken, paramCtrl.actualizar);
router.patch('/:id/reactivar', verifyToken, paramCtrl.reactivar);
router.delete('/:id', verifyToken, paramCtrl.desactivar);

module.exports = router;