const express = require('express');
const router = express.Router();
const adminCtrl = require('../controllers/adminController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');
const upload = require('../config/multer');
const ROLES = require('../config/roles');

const ADMIN = [ROLES.ADMIN];

// Ruta para ver el perfil
router.get('/perfil', verifyToken, checkRole(ADMIN), adminCtrl.obtenerPerfil);

// Ruta para actualizar (incluye la subida de la firma)
router.put('/perfil', 
    verifyToken, 
    checkRole(ADMIN), 
    upload.single('firma'), // 'firma' es el nombre del campo en el FormData del frontend
    adminCtrl.actualizarPerfil
);

module.exports = router;