const express = require('express');
const router = express.Router();
const adminCtrl = require('../controllers/adminController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');
const upload = require('../config/multer');

// Ruta para ver el perfil
router.get('/perfil', verifyToken, checkRole(['Administrador']), adminCtrl.obtenerPerfil);

// Ruta para actualizar (incluye la subida de la firma)
router.put('/perfil', 
    verifyToken, 
    checkRole(['Administrador']), 
    upload.single('firma'), // 'firma' es el nombre del campo en el FormData del frontend
    adminCtrl.actualizarPerfil
);

module.exports = router;