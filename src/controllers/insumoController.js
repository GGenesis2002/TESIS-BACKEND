/**
 * insumoController.js
 * Controlador completo del módulo de Inventario.
 */

const insumoModule  = require('../modules/insumoModule');
const pool          = require('../config/db');
const { getConfig } = require('./configuracionController');
const { registrarAuditoria } = require('../helpers/auditoria');

// Helper: obtiene id_usuario_rol desde el header o lo resuelve desde la BD
const getIdUsuarioRol = async (req) => {
  if (req.user?.id_usuario_rol) return req.user.id_usuario_rol;
  // Si el frontend no envió el header, buscamos el primer rol activo del usuario
  const { rows } = await pool.query(
    `SELECT id_usuario_rol FROM usuario_rol WHERE id_usuario = $1 AND activo = TRUE LIMIT 1`,
    [req.user.id]
  );
  return rows[0]?.id_usuario_rol || null;
};

const insumoController = {

  // ════════════════════════════════════════════════════════
  // CATEGORÍAS
  // ════════════════════════════════════════════════════════

  getCategorias: async (req, res) => {
    try { res.json(await insumoModule.listarCategorias()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  },

  crearCategoria: async (req, res) => {
    const { nombre } = req.body;
    if (!nombre?.trim())
      return res.status(400).json({ error: "El nombre de la categoría es obligatorio" });
    try { res.status(201).json(await insumoModule.crearCategoria(req.body, req.user.id)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  },

  actualizarCategoria: async (req, res) => {
    const { nombre } = req.body;
    if (!nombre?.trim())
      return res.status(400).json({ error: "El nombre de la categoría es obligatorio" });
    try { res.json(await insumoModule.actualizarCategoria(req.params.id, req.body, req.user.id)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  },

  eliminarCategoria: async (req, res) => {
    try { res.json(await insumoModule.eliminarCategoria(req.params.id, req.user.id)); }
    catch (e) {
      const status = e.message.includes("No se puede eliminar") ? 409 : 500;
      res.status(status).json({ error: e.message });
    }
  },

  // ════════════════════════════════════════════════════════
  // INSUMOS — CRUD
  // ════════════════════════════════════════════════════════

  getInsumos: async (req, res) => {
    try { res.json(await insumoModule.listarInsumos()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  },

  postInsumo: async (req, res) => {
    try { res.status(201).json(await insumoModule.crearInsumo(req.body, req.user.id)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  },

  putInsumo: async (req, res) => {
    try { res.json(await insumoModule.actualizarInsumo(req.params.id, req.body, req.user.id)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  },

  deleteInsumo: async (req, res) => {
    try { res.json(await insumoModule.eliminarInsumo(req.params.id, req.user.id)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  },

  // ════════════════════════════════════════════════════════
  // HISTORIAL DE MOVIMIENTOS
  // ════════════════════════════════════════════════════════

  getMovimientos: async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT
          m.id_movimiento,
          m.tipo_movimiento,
          m.cantidad,
          m.observacion,
          m.fecha,
          i.nombre                              AS insumo,
          i.unidad_medida,
          u.nombres || ' ' || u.apellidos       AS usuario_nombre,
          u.username
        FROM movimientos m
        JOIN insumos  i ON m.id_insumo  = i.id_insumo
        JOIN usuario  u ON m.id_usuario = u.id_usuario
        ORDER BY m.fecha DESC
        LIMIT 300
      `);
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  },

  // ════════════════════════════════════════════════════════
  // ALERTAS
  // ════════════════════════════════════════════════════════

  listarAlertas: async (req, res) => {
    try { res.json(await insumoModule.getAlertasReabastecimiento()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  },

  // ════════════════════════════════════════════════════════
  // RECETAS (Examen ↔ Insumo)
  // ════════════════════════════════════════════════════════

  getRecetas: async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT
          ei.id_examen_insumo,
          ei.id_examen,
          ei.id_insumo,
          ei.cantidad_usada,
          e.nombre_examen,
          i.nombre          AS nombre_insumo,
          i.unidad_medida,
          tm.nombre         AS tipo_muestra_nombre
        FROM examen_insumo ei
        JOIN examen       e  ON ei.id_examen = e.id_examen
        JOIN insumos      i  ON ei.id_insumo = i.id_insumo
        LEFT JOIN tipo_muestra tm ON i.id_tipo_muestra = tm.id_tipo_muestra
        ORDER BY e.nombre_examen ASC, i.nombre ASC
      `);
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  },

  // ════════════════════════════════════════════════════════
  // TIPOS DE MUESTRA
  // ════════════════════════════════════════════════════════

  getTiposMuestra: async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT id_tipo_muestra, nombre FROM tipo_muestra ORDER BY nombre ASC`
      );
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  },

  crearTipoMuestra: async (req, res) => {
    const { nombre } = req.body;
    if (!nombre?.trim())
      return res.status(400).json({ error: "El nombre del tipo de muestra es obligatorio" });
    try {
      const { rows } = await pool.query(
        `INSERT INTO tipo_muestra (nombre) VALUES ($1)
         ON CONFLICT DO NOTHING RETURNING *`,
        [nombre.trim()]
      );
      if (rows.length === 0)
        return res.status(409).json({ error: "Ya existe un tipo con ese nombre" });

      const idUsuarioRol = await getIdUsuarioRol(req);
      await registrarAuditoria(
        pool,
        req.user.id,
        idUsuarioRol,
        'CREAR_TIPO_MUESTRA',
        `Tipo de muestra creado: "${nombre.trim()}"`
      );
      res.status(201).json(rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  },

  eliminarTipoMuestra: async (req, res) => {
    try {
      const { rowCount: enUsoInsumo } = await pool.query(
        `SELECT 1 FROM insumos WHERE id_tipo_muestra = $1 AND estado = TRUE LIMIT 1`,
        [req.params.id]
      );
      if (enUsoInsumo > 0)
        return res.status(409).json({ error: "No se puede eliminar: hay insumos activos con este tipo" });

      // Obtener el nombre antes de borrar (para la auditoría)
      const { rows: tipoRows } = await pool.query(
        `SELECT nombre FROM tipo_muestra WHERE id_tipo_muestra = $1`, [req.params.id]
      );
      const nombreTipo = tipoRows[0]?.nombre || `ID ${req.params.id}`;

      await pool.query(`DELETE FROM tipo_muestra WHERE id_tipo_muestra = $1`, [req.params.id]);

      const idUsuarioRol = await getIdUsuarioRol(req);
      await registrarAuditoria(
        pool,
        req.user.id,
        idUsuarioRol,
        'ELIMINAR_TIPO_MUESTRA',
        `Tipo de muestra eliminado: "${nombreTipo}"`
      );
      res.json({ msg: "Tipo de muestra eliminado" });
    } catch (e) { res.status(500).json({ error: e.message }); }
  },

  // ════════════════════════════════════════════════════════
  // ASIGNAR / QUITAR TIPO DE MUESTRA A EXAMEN (pivote)
  // ════════════════════════════════════════════════════════

  asignarTipoExamen: async (req, res) => {
    const { id_examen, id_tipo_muestra } = req.body;
    if (!id_examen || !id_tipo_muestra)
      return res.status(400).json({ error: "id_examen e id_tipo_muestra son obligatorios" });
    try {
      await pool.query(
        `INSERT INTO examen_tipo_muestra (id_examen, id_tipo_muestra)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [id_examen, id_tipo_muestra]
      );
      const idUsuarioRol = await getIdUsuarioRol(req);
      await registrarAuditoria(
        pool,
        req.user.id,
        idUsuarioRol,
        'ASIGNAR_TIPO_MUESTRA_EXAMEN',
        `Tipo de muestra ID ${id_tipo_muestra} asignado al examen ID ${id_examen}`
      );
      res.json({ msg: "Tipo de muestra asignado" });
    } catch (e) { res.status(500).json({ error: e.message }); }
  },

  quitarTipoExamen: async (req, res) => {
    const { id_examen, id_tipo } = req.params;
    try {
      await pool.query(
        `DELETE FROM examen_tipo_muestra WHERE id_examen = $1 AND id_tipo_muestra = $2`,
        [id_examen, id_tipo]
      );
      const idUsuarioRol = await getIdUsuarioRol(req);
      await registrarAuditoria(
        pool,
        req.user.id,
        idUsuarioRol,
        'QUITAR_TIPO_MUESTRA_EXAMEN',
        `Tipo de muestra ID ${id_tipo} quitado del examen ID ${id_examen}`
      );
      res.json({ msg: "Tipo de muestra quitado" });
    } catch (e) { res.status(500).json({ error: e.message }); }
  },

  vincularExamen: async (req, res) => {
    const { id_examen, id_insumo, cantidad_usada } = req.body;
    if (!id_examen || !id_insumo || !cantidad_usada)
      return res.status(400).json({ error: "id_examen, id_insumo y cantidad_usada son obligatorios" });
    try {
      const receta = await insumoModule.configurarReceta(id_examen, id_insumo, cantidad_usada, req.user.id);
      const idUsuarioRol = await getIdUsuarioRol(req);
      await registrarAuditoria(
        pool,
        req.user.id,
        idUsuarioRol,
        'VINCULAR_EXAMEN_INSUMO',
        `Examen ID ${id_examen} vinculado con Insumo ID ${id_insumo} (cantidad: ${cantidad_usada})`
      );
      res.json(receta);
    } catch (e) { res.status(500).json({ error: e.message }); }
  },

  eliminarReceta: async (req, res) => {
    try {
      const { rowCount } = await pool.query(
        'DELETE FROM examen_insumo WHERE id_examen_insumo = $1', [req.params.id]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Vinculación no encontrada" });

      const idUsuarioRol = await getIdUsuarioRol(req);
      await registrarAuditoria(
        pool,
        req.user.id,
        idUsuarioRol,
        'ELIMINAR_RECETA',
        `Vinculación examen-insumo ID ${req.params.id} eliminada`
      );
      res.json({ msg: "Vinculación eliminada correctamente" });
    } catch (e) { res.status(500).json({ error: e.message }); }
  },

  // ════════════════════════════════════════════════════════
  // MOVIMIENTO MANUAL DE STOCK
  // ════════════════════════════════════════════════════════

  registrarMovimiento: async (req, res) => {
    try {
      const resultado = await insumoModule.ajusteStockManual(req.body, req.user.id);

      const cfg = await getConfig();
      if (cfg.notificarAlertasStock && req.body.id_insumo) {

        // Resolver alertas PENDIENTES de insumos que ya tienen stock suficiente
        await pool.query(`
          UPDATE reabastecimiento r
          SET estado = 'RESUELTA'
          FROM insumos i
          WHERE r.id_insumo = i.id_insumo
            AND r.estado = 'PENDIENTE'
            AND i.stock_actual > i.stock_minimo
        `);

        // Consultar estado actual del insumo afectado
        const { rows } = await pool.query(
          'SELECT nombre, stock_actual, stock_minimo, unidad_medida FROM insumos WHERE id_insumo = $1',
          [req.body.id_insumo]
        );
        const ins = rows[0];

        if (ins && ins.stock_actual <= ins.stock_minimo) {
          // Notificar a administradores (usando la tabla pivote usuario_rol)
          const admins = await pool.query(`
            SELECT DISTINCT u.id_usuario
            FROM usuario u
            JOIN usuario_rol ur ON ur.id_usuario = u.id_usuario
            JOIN rol r ON r.id_rol = ur.id_rol
            WHERE LOWER(r.nombre) = 'administrador'
              AND ur.activo = TRUE
              AND u.estado = TRUE
          `);
          for (const adm of admins.rows) {
            await pool.query(
              `INSERT INTO notificacion (id_usuario, mensaje) VALUES ($1, $2)`,
              [adm.id_usuario,
               `⚠️ Stock bajo: "${ins.nombre}" — quedan ${ins.stock_actual} ${ins.unidad_medida} (mínimo: ${ins.stock_minimo})`]
            );
          }

          // Crear alerta de reabastecimiento solo si no hay una PENDIENTE ya
          const yaExiste = await pool.query(
            `SELECT 1 FROM reabastecimiento WHERE id_insumo = $1 AND estado = 'PENDIENTE' LIMIT 1`,
            [req.body.id_insumo]
          );
          if (yaExiste.rowCount === 0) {
            await pool.query(
              `INSERT INTO reabastecimiento (id_insumo, cantidad_reportada, estado)
               VALUES ($1, $2, 'PENDIENTE')`,
              [req.body.id_insumo, ins.stock_minimo - ins.stock_actual]
            );
          }
        }
      }

      const idUsuarioRol = await getIdUsuarioRol(req);
      await registrarAuditoria(
        pool,
        req.user.id,
        idUsuarioRol,
        'MOVIMIENTO_STOCK_MANUAL',
        `${req.body.tipo_movimiento}: ${req.body.cantidad} unidades — Insumo ID ${req.body.id_insumo}. ${req.body.observacion || ''}`
      );

      res.json(resultado);
    } catch (e) {
      res.status(e.message.includes("insuficiente") ? 400 : 500).json({ error: e.message });
    }
  },
};

module.exports = insumoController;