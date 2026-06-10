// route/rol.routes.js
const express = require('express');
const router = express.Router();
const rolController = require('../controller/rol.controller');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');

// Definimos la ruta GET
router.get('/roles', rolController.obtenerRoles);

module.exports = router;