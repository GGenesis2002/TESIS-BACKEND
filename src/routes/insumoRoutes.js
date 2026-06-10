const router       = require('express').Router();
const ctrl         = require('../controllers/insumoController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');


// ── CATEGORÍAS DE INSUMOS (CRUD completo) ─────────────────────────────────────
router.get   ('/categorias',         verifyToken, ctrl.getCategorias);
router.post  ('/categorias',         verifyToken, ctrl.crearCategoria);
router.put   ('/categorias/:id',     verifyToken, ctrl.actualizarCategoria);
router.delete('/categorias/:id',     verifyToken, ctrl.eliminarCategoria);

// ── ALERTAS DE REABASTECIMIENTO ───────────────────────────────────────────────
router.get('/alertas', verifyToken, ctrl.listarAlertas);

// ── HISTORIAL DE MOVIMIENTOS ──────────────────────────────────────────────────
router.get('/movimientos', verifyToken, ctrl.getMovimientos);

// ── RECETAS (Examen ↔ Insumo) ─────────────────────────────────────────────────
router.get   ('/recetas',        verifyToken, ctrl.getRecetas);
router.post  ('/receta',         verifyToken, ctrl.vincularExamen);
router.delete('/receta/:id',     verifyToken, ctrl.eliminarReceta);

// ── ASIGNAR / QUITAR TIPO DE MUESTRA A EXAMEN ────────────────────────────────
router.post  ('/examen-tipo-muestra',                     verifyToken, ctrl.asignarTipoExamen);
router.delete('/examen-tipo-muestra/:id_examen/:id_tipo', verifyToken, ctrl.quitarTipoExamen);

// ── CRUD INSUMOS (/:id siempre al final) ─────────────────────────────────────
router.get   ('/',     verifyToken, ctrl.getInsumos);
router.post  ('/',     verifyToken, ctrl.postInsumo);
router.put   ('/:id',  verifyToken, ctrl.putInsumo);
router.delete('/:id',  verifyToken, ctrl.deleteInsumo);

// ── MOVIMIENTO MANUAL DE STOCK ────────────────────────────────────────────────
router.post('/movimiento', verifyToken, ctrl.registrarMovimiento);

module.exports = router;