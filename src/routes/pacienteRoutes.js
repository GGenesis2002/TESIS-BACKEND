const express = require('express');
const router = express.Router();
const controller = require('../controllers/pacienteController');
const { verifyToken } = require('../middlewares/authMiddleware');

// Rutas públicas
router.post('/registro', controller.registrarPaciente);

// Perfil propio (el paciente edita su cuenta desde el app)
router.put('/perfil', verifyToken, controller.editarPerfilPropio);

// Rutas protegidas
router.get('/', verifyToken, controller.listarPacientes);
router.put('/:id', verifyToken, controller.actualizarPaciente);
router.delete('/:id', verifyToken, controller.desactivar);
router.get('/mis-resultados/:id_orden', verifyToken, controller.verResultadosPaciente);
router.put('/reactivar/:id', verifyToken, controller.reactivar);

module.exports = router;