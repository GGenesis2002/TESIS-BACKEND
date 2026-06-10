const express = require('express');
const router = express.Router();
const asigCtrl = require('../controllers/asignacionController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');


router.post('/', verifyToken, asigCtrl.asignar);
router.get('/', verifyToken, asigCtrl.listar);
router.post('/remover', verifyToken, asigCtrl.desasignarExamen); // Nueva ruta para sincronizar edición
router.delete('/:id', verifyToken, asigCtrl.quitarAsignacion);

module.exports = router;