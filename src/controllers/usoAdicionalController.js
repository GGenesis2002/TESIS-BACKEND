/**
 * usoAdicionalController.js
 *
 * Maneja los "usos adicionales" de insumos: cuando la analista
 * usa un insumo extra que NO se descontó automáticamente por la
 * receta (ej: jeringa tapada, tubo roto, etc.).
 *
 * ESTRATEGIA SIN NUEVAS TABLAS:
 *  - Se guarda en `reabastecimiento` con cantidad_reportada NEGATIVA
 *    y una columna "observacion" (añadida como ALTER TABLE si no existe).
 *    Si no quieres tocar la BD, se usa la columna existente `estado`
 *    con valores: 'USO_ADICIONAL_PENDIENTE' | 'USO_ADICIONAL_APROBADO' | 'USO_ADICIONAL_RECHAZADO'
 *  - Al aprobar, se inserta en `movimientos` como SALIDA y se descuenta stock.
 *  - Se notifica al administrador vía tabla `notificacion`.
 *
 * NOTA: Si la tabla `reabastecimiento` no tiene columna `observacion`,
 * ejecutar en PostgreSQL:
 *   ALTER TABLE reabastecimiento ADD COLUMN IF NOT EXISTS observacion TEXT;
 *   ALTER TABLE reabastecimiento ADD COLUMN IF NOT EXISTS id_orden INT REFERENCES orden_medica(id_orden);
 *   ALTER TABLE reabastecimiento ADD COLUMN IF NOT EXISTS id_usuario_reporta INT REFERENCES usuario(id_usuario);
 */

const pool = require('../config/db');
const { registrarAuditoria } = require('../helpers/auditoria');

const usoAdicionalController = {

  // ────────────────────────────────────────────────────────────────────────────
  // POST /usos-adicionales
  // La analista registra un uso extra de insumos para una orden.
  // ────────────────────────────────────────────────────────────────────────────
  registrar: async (req, res) => {
    const { id_orden, id_insumo, cantidad, motivo } = req.body;

    if (!id_orden || !id_insumo || !cantidad || cantidad <= 0)
      return res.status(400).json({ error: 'id_orden, id_insumo y cantidad (> 0) son obligatorios' });
    if (!motivo?.trim())
      return res.status(400).json({ error: 'Debes indicar el motivo del uso adicional' });

    try {
      // 1. Verificar que la orden exista y tenga un estado válido
      const { rows: orden } = await pool.query(
        `SELECT numero_ticket, estado FROM orden_medica WHERE id_orden = $1`,
        [id_orden]
      );
      if (orden.length === 0)
        return res.status(404).json({ error: 'Orden no encontrada' });

      const estadosValidos = ['Pagada', 'En Proceso', 'Por Validar', 'Muestra Tomada'];
      if (!estadosValidos.includes(orden[0].estado))
        return res.status(400).json({
          error: `No se puede registrar un uso adicional en una orden con estado "${orden[0].estado}"`
        });

      // 2. Verificar que el insumo exista
      const { rows: ins } = await pool.query(
        `SELECT nombre, stock_actual, unidad_medida FROM insumos WHERE id_insumo = $1 AND estado = TRUE`,
        [id_insumo]
      );
      if (ins.length === 0)
        return res.status(404).json({ error: 'Insumo no encontrado o inactivo' });

      // 3. Guardar en reabastecimiento con estado especial 'USO_ADICIONAL_PENDIENTE'
      //    y cantidad negativa para diferenciarlo de alertas normales.
      const { rows: nuevo } = await pool.query(
        `INSERT INTO reabastecimiento
           (id_insumo, cantidad_reportada, estado, observacion, id_orden, id_usuario_reporta)
         VALUES ($1, $2, 'USO_ADICIONAL_PENDIENTE', $3, $4, $5)
         RETURNING *`,
        [id_insumo, cantidad, motivo.trim(), id_orden, req.user.id]
      );

      // 4. Notificar a todos los administradores activos
      const { rows: admins } = await pool.query(
        `SELECT u.id_usuario FROM usuario u
         JOIN usuario_rol ur ON ur.id_usuario = u.id_usuario
         JOIN rol r ON ur.id_rol = r.id_rol
         WHERE LOWER(r.nombre) = 'administrador'
           AND u.estado = TRUE AND ur.activo = TRUE`
      );

      const mensaje =
        `📋 Uso adicional pendiente: "${ins[0].nombre}" × ${cantidad} ${ins[0].unidad_medida}` +
        ` — Orden ${orden[0].numero_ticket}. Motivo: "${motivo.trim()}"`;

      for (const adm of admins) {
        await pool.query(
          `INSERT INTO notificacion (id_usuario, mensaje) VALUES ($1, $2)`,
          [adm.id_usuario, mensaje]
        );
      }

      // 5. Auditoría
      await registrarAuditoria(
        pool,
        req.user.id,
        req.user.id_usuario_rol || null,
        'REGISTRO_USO_ADICIONAL',
        `Uso adicional registrado: insumo "${ins[0].nombre}" × ${cantidad}, orden ${orden[0].numero_ticket}. Motivo: ${motivo}`
      );

      res.status(201).json({
        msg: 'Uso adicional registrado. El administrador recibirá una notificación para aprobarlo.',
        reporte: nuevo[0],
      });

    } catch (e) {
      console.error('Error registrar uso adicional:', e.message);
      res.status(500).json({ error: e.message });
    }
  },

  // ────────────────────────────────────────────────────────────────────────────
  // GET /usos-adicionales
  // Admin obtiene todos los usos adicionales pendientes (y el historial).
  // ────────────────────────────────────────────────────────────────────────────
  listar: async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT
          r.id_reporte,
          r.id_insumo,
          r.cantidad_reportada        AS cantidad,
          r.fecha_reporte,
          r.estado,
          r.observacion               AS motivo,
          r.id_orden,
          i.nombre                    AS insumo_nombre,
          i.unidad_medida,
          i.stock_actual,
          o.numero_ticket,
          o.estado                    AS estado_orden,
          u_rep.nombres  || ' ' || u_rep.apellidos  AS reportado_por,
          u_rep.username              AS username_reporta
        FROM reabastecimiento r
        JOIN insumos      i     ON r.id_insumo        = i.id_insumo
        LEFT JOIN orden_medica o ON r.id_orden         = o.id_orden
        LEFT JOIN usuario u_rep  ON r.id_usuario_reporta = u_rep.id_usuario
        WHERE r.estado IN (
          'USO_ADICIONAL_PENDIENTE',
          'USO_ADICIONAL_APROBADO',
          'USO_ADICIONAL_RECHAZADO'
        )
        ORDER BY
          CASE r.estado WHEN 'USO_ADICIONAL_PENDIENTE' THEN 0 ELSE 1 END,
          r.fecha_reporte DESC
        LIMIT 200
      `);
      res.json(rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  },

  // ────────────────────────────────────────────────────────────────────────────
  // POST /usos-adicionales/:id/aprobar
  // Admin aprueba → se descuenta del stock y se registra en movimientos.
  // ────────────────────────────────────────────────────────────────────────────
  aprobar: async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Obtener el reporte y verificar que esté pendiente
      const { rows: rep } = await client.query(
        `SELECT r.*, i.nombre AS insumo_nombre, i.stock_actual, i.unidad_medida
         FROM reabastecimiento r
         JOIN insumos i ON r.id_insumo = i.id_insumo
         WHERE r.id_reporte = $1
           AND r.estado = 'USO_ADICIONAL_PENDIENTE'`,
        [id]
      );
      if (rep.length === 0)
        return res.status(404).json({ error: 'Reporte no encontrado o ya procesado' });

      const r = rep[0];

      // 2. Verificar stock suficiente
      if (r.stock_actual < r.cantidad_reportada)
        return res.status(400).json({
          error: `Stock insuficiente. Disponible: ${r.stock_actual} ${r.unidad_medida}, solicitado: ${r.cantidad_reportada}`
        });

      // 3. Descontar del stock
      await client.query(
        `UPDATE insumos SET stock_actual = stock_actual - $1 WHERE id_insumo = $2`,
        [r.cantidad_reportada, r.id_insumo]
      );

      // 4. Registrar en movimientos
      await client.query(
        `INSERT INTO movimientos (id_insumo, id_usuario, tipo_movimiento, cantidad, observacion)
         VALUES ($1, $2, 'SALIDA', $3, $4)`,
        [
          r.id_insumo,
          req.user.id,
          r.cantidad_reportada,
          `[USO ADICIONAL APROBADO] ${r.observacion || ''} — Orden: ${r.id_orden || 'N/A'}`,
        ]
      );

      // 5. Actualizar estado del reporte
      await client.query(
        `UPDATE reabastecimiento SET estado = 'USO_ADICIONAL_APROBADO' WHERE id_reporte = $1`,
        [id]
      );

      // 6. Auditoría
      await client.query(
        `INSERT INTO auditoria (id_usuario, id_usuario_rol, accion, descripcion) VALUES ($1, $2, $3, $4)`,
        [
          req.user.id,
          req.user.id_usuario_rol || null,
          'APROBAR_USO_ADICIONAL',
          `Uso adicional aprobado: "${r.insumo_nombre}" × ${r.cantidad_reportada} ${r.unidad_medida}. Motivo: ${r.observacion}`,
        ]
      );

      await client.query('COMMIT');

      res.json({
        msg: `✅ Uso adicional aprobado. Se descontaron ${r.cantidad_reportada} ${r.unidad_medida} de "${r.insumo_nombre}".`,
        stock_nuevo: r.stock_actual - r.cantidad_reportada,
      });

    } catch (e) {
      await client.query('ROLLBACK');
      console.error('Error aprobar uso adicional:', e.message);
      res.status(500).json({ error: e.message });
    } finally {
      client.release();
    }
  },

  // ────────────────────────────────────────────────────────────────────────────
  // POST /usos-adicionales/:id/rechazar
  // Admin rechaza → no se descuenta nada, se deja el estado como RECHAZADO.
  // ────────────────────────────────────────────────────────────────────────────
  rechazar: async (req, res) => {
    const { id } = req.params;
    const { motivo_rechazo } = req.body;

    try {
      const { rows: rep } = await pool.query(
        `SELECT r.*, i.nombre AS insumo_nombre, i.unidad_medida
         FROM reabastecimiento r
         JOIN insumos i ON r.id_insumo = i.id_insumo
         WHERE r.id_reporte = $1 AND r.estado = 'USO_ADICIONAL_PENDIENTE'`,
        [id]
      );
      if (rep.length === 0)
        return res.status(404).json({ error: 'Reporte no encontrado o ya procesado' });

      const r = rep[0];

      // Guardar motivo de rechazo en observacion
      const obs_final = motivo_rechazo?.trim()
        ? `${r.observacion || ''} | RECHAZADO: ${motivo_rechazo.trim()}`
        : r.observacion;

      await pool.query(
        `UPDATE reabastecimiento
         SET estado = 'USO_ADICIONAL_RECHAZADO', observacion = $1
         WHERE id_reporte = $2`,
        [obs_final, id]
      );

      await registrarAuditoria(
        pool,
        req.user.id,
        req.user.id_usuario_rol || null,
        'RECHAZAR_USO_ADICIONAL',
        `Uso adicional rechazado: "${r.insumo_nombre}" × ${r.cantidad_reportada} ${r.unidad_medida}. ${obs_final}`
      );

      res.json({ msg: `❌ Uso adicional rechazado. No se modificó el stock.` });

    } catch (e) {
      console.error('Error rechazar uso adicional:', e.message);
      res.status(500).json({ error: e.message });
    }
  },
};

module.exports = usoAdicionalController;
