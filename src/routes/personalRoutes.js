const express = require('express');
const router = express.Router();
const personalController = require('../controllers/personalController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');


router.get('/', verifyToken, personalController.listarPersonal);
router.get('/consultar-cedula/:cedula', verifyToken, personalController.consultarPorCedula);
router.get('/:id', verifyToken, personalController.obtenerEmpleado);
router.post('/registro', verifyToken, personalController.registrarPersonal);
router.put('/:id', verifyToken, personalController.actualizarPersonal);

module.exports = router;