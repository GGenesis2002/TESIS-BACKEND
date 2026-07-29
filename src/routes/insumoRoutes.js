const router = require('express').Router();
const ctrl = require('../controllers/insumoController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');
const ROLES = require('../config/roles');

// "Inventario" está asignado exclusivamente a Administrador en el reglamento.
const INVENTARIO = [ROLES.ADMIN];
const INSUMOS_EXTRAS= [ROLES.ASISTENTE];

// ── CATEGORÍAS DE INSUMOS (CRUD completo) ─────────────────────────────────────
router.get   ('/categorias',         verifyToken, checkRole(INVENTARIO), ctrl.getCategorias);
router.post  ('/categorias',         verifyToken, checkRole(INVENTARIO), ctrl.crearCategoria);
router.put   ('/categorias/:id',     verifyToken, checkRole(INVENTARIO), ctrl.actualizarCategoria);
router.delete('/categorias/:id',     verifyToken, checkRole(INVENTARIO), ctrl.eliminarCategoria);

// ── ALERTAS DE REABASTECIMIENTO ───────────────────────────────────────────────
router.get('/alertas', verifyToken, checkRole(INVENTARIO), ctrl.listarAlertas);

// ── HISTORIAL DE MOVIMIENTOS ──────────────────────────────────────────────────
router.get('/movimientos', verifyToken, checkRole(INVENTARIO), ctrl.getMovimientos);

// ── RECETAS (Examen ↔ Insumo) ─────────────────────────────────────────────────
router.get   ('/recetas',        verifyToken, checkRole(INVENTARIO), ctrl.getRecetas);
router.post  ('/receta',         verifyToken, checkRole(INVENTARIO), ctrl.vincularExamen);
router.delete('/receta/:id',     verifyToken, checkRole(INVENTARIO), ctrl.eliminarReceta);

// ── ASIGNAR / QUITAR TIPO DE MUESTRA A EXAMEN ────────────────────────────────
router.post  ('/examen-tipo-muestra',                     verifyToken, checkRole(INVENTARIO), ctrl.asignarTipoExamen);
router.delete('/examen-tipo-muestra/:id_examen/:id_tipo', verifyToken, checkRole(INVENTARIO), ctrl.quitarTipoExamen);

// ── CRUD INSUMOS (/:id siempre al final) ─────────────────────────────────────
router.get   ('/',     verifyToken, checkRole(INVENTARIO, INSUMOS_EXTRAS), ctrl.getInsumos);
router.post  ('/',     verifyToken, checkRole(INVENTARIO), ctrl.postInsumo);
router.put   ('/:id',  verifyToken, checkRole(INVENTARIO), ctrl.putInsumo);
router.delete('/:id',  verifyToken, checkRole(INVENTARIO), ctrl.deleteInsumo);

// ── MOVIMIENTO MANUAL DE STOCK ────────────────────────────────────────────────
router.post('/movimiento', verifyToken, checkRole(INVENTARIO), ctrl.registrarMovimiento);

module.exports = router;