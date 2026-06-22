/**
 * test-cron-jobs.js
 *
 * Script de diagnóstico para verificar que la lógica de los cron jobs
 * (scheduledTasks.js) funciona correctamente, SIN esperar a que llegue
 * la hora programada y SIN modificar datos reales de pacientes.
 *
 * - JOB 1 (pacientes inactivos): solo hace SELECT, nunca actualiza nada.
 *   Te muestra exactamente quién se desactivaría hoy y quién necesita
 *   revisión manual (ultimo_acceso NULL).
 *
 * - JOB 2 (resultados viejos): crea una orden_medica + resultado de
 *   PRUEBA con fecha vieja, corre la misma lógica que el cron real,
 *   y al final BORRA esos datos de prueba (estén o no eliminados ya
 *   por la simulación), dejando la base de datos como estaba.
 *
 * Uso:
 *   node test-cron-jobs.js
 *
 * Requiere las mismas variables de entorno que usa tu app (.env con
 * la conexión a Postgres), y debe correrse desde un lugar donde
 * '../config/db' resuelva correctamente (mismo nivel que tus otros
 * helpers, ej. dentro de src/helpers/ o ajusta el require abajo).
 */

require('dotenv').config();
const pool = require('../src/config/db'); // tests/ está fuera de src/, por eso se sube un nivel y se entra a src/config

function linea() {
  console.log('─'.repeat(70));
}

async function probarJob1() {
  console.log('\n🔍 JOB 1 — Pacientes inactivos (SOLO LECTURA, no modifica nada)');
  linea();

  // Misma condición exacta que usa el cron real para decidir a quién desactivaría
  const { rows: aDesactivar } = await pool.query(`
    SELECT u.id_usuario, u.username, u.ultimo_acceso,
           NOW() - u.ultimo_acceso AS tiempo_inactivo
    FROM usuario u
    WHERE u.estado = TRUE
      AND u.ultimo_acceso IS NOT NULL
      AND u.ultimo_acceso < NOW() - INTERVAL '30 days'
      AND u.id_usuario IN (
          SELECT ur.id_usuario FROM usuario_rol ur
          JOIN rol r ON ur.id_rol = r.id_rol
          WHERE r.nombre = 'Paciente' AND ur.activo = TRUE
      )
  `);

  if (aDesactivar.length === 0) {
    console.log('✅ Hoy no hay ningún paciente que cumpla 30+ días de inactividad real.');
  } else {
    console.log(`⚠️  Estos ${aDesactivar.length} paciente(s) SE DESACTIVARÍAN esta noche:`);
    for (const p of aDesactivar) {
      console.log(`   - ID ${p.id_usuario} (${p.username}) — inactivo: ${p.tiempo_inactivo}`);
    }
  }

  // Casos NULL que requieren revisión manual (igual que hace el cron real)
  const { rows: sinAcceso } = await pool.query(`
    SELECT u.id_usuario, u.username
    FROM usuario u
    JOIN usuario_rol ur ON ur.id_usuario = u.id_usuario
    JOIN rol r ON ur.id_rol = r.id_rol
    WHERE u.estado = TRUE
      AND u.ultimo_acceso IS NULL
      AND r.nombre = 'Paciente'
      AND ur.activo = TRUE
  `);

  if (sinAcceso.length > 0) {
    console.log(`\nℹ️  ${sinAcceso.length} paciente(s) con ultimo_acceso = NULL (requieren revisión manual, no se tocan):`);
    for (const p of sinAcceso) {
      console.log(`   - ID ${p.id_usuario} (${p.username})`);
    }
  } else {
    console.log('\n✅ No hay pacientes con ultimo_acceso en NULL.');
  }

  console.log('\n👉 Esta simulación NO modificó ninguna fila. Es exactamente lo que');
  console.log('   el cron real haría si corriera en este momento.');
}

async function probarJob2() {
  console.log('\n\n🔍 JOB 2 — Resultados viejos (crea datos de PRUEBA, luego los borra)');
  linea();

  const client = await pool.connect();
  let idOrdenPrueba = null;
  let idResultadoPrueba = null;

  try {
    await client.query('BEGIN');

    // 1. Buscar un paciente real cualquiera para poder crear la orden de prueba
    const { rows: pacientes } = await client.query(
      'SELECT id_paciente FROM paciente LIMIT 1'
    );
    if (pacientes.length === 0) {
      console.log('❌ No hay ningún paciente en la tabla "paciente". No se puede crear la orden de prueba.');
      await client.query('ROLLBACK');
      return;
    }
    const idPaciente = pacientes[0].id_paciente;

    // 2. Crear orden_medica de prueba con fecha de 91 días atrás
    // numero_ticket es VARCHAR(20) — usamos solo los últimos 10 dígitos del
    // timestamp para no exceder el límite (TEST + 10 dígitos = 14 caracteres)
    const ticketPrueba = `TEST${Date.now().toString().slice(-10)}`;
    const { rows: ordenRows } = await client.query(
      `INSERT INTO orden_medica (id_paciente, fecha_orden, estado, numero_ticket)
       VALUES ($1, NOW() - INTERVAL '91 days', 'Finalizada', $2)
       RETURNING id_orden`,
      [idPaciente, ticketPrueba]
    );
    idOrdenPrueba = ordenRows[0].id_orden;
    console.log(`✅ Orden de prueba creada: id_orden=${idOrdenPrueba} (fecha_orden hace 91 días)`);

    // 3. Crear resultado de prueba en estado 'Validado'
    const { rows: resultadoRows } = await client.query(
      `INSERT INTO resultado (id_orden, estado, tipo_resultado)
       VALUES ($1, 'Validado', 'PARAMETROS')
       RETURNING id_resultado`,
      [idOrdenPrueba]
    );
    idResultadoPrueba = resultadoRows[0].id_resultado;
    console.log(`✅ Resultado de prueba creado: id_resultado=${idResultadoPrueba} (estado=Validado)`);

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ Error creando datos de prueba:', e.message);
    client.release();
    return;
  }

  try {
    // 4. Correr la MISMA query que usa el cron real, para confirmar que detecta
    //    el resultado de prueba que acabamos de crear
    const { rows: viejos } = await pool.query(`
      SELECT r.id_resultado 
      FROM resultado r
      JOIN orden_medica o ON r.id_orden = o.id_orden
      WHERE o.fecha_orden < NOW() - INTERVAL '90 days'
        AND r.estado = 'Validado'
    `);

    const detectado = viejos.some(v => v.id_resultado === idResultadoPrueba);
    if (detectado) {
      console.log(`\n✅ La query del cron SÍ detectó el resultado de prueba (id_resultado=${idResultadoPrueba}).`);
      console.log(`   Coincide con ${viejos.length} resultado(s) viejo(s) en total en tu BD ahora mismo.`);
    } else {
      console.log(`\n⚠️  La query del cron NO detectó el resultado de prueba. Revisa la lógica.`);
    }
  } catch (e) {
    console.error('❌ Error ejecutando la query de diagnóstico:', e.message);
  } finally {
    // 5. Limpieza: borrar SIEMPRE los datos de prueba, pase lo que pase arriba
    try {
      if (idResultadoPrueba) {
        await pool.query('DELETE FROM detalle_resultado WHERE id_resultado = $1', [idResultadoPrueba]);
        await pool.query('DELETE FROM resultado WHERE id_resultado = $1', [idResultadoPrueba]);
      }
      if (idOrdenPrueba) {
        await pool.query('DELETE FROM orden_medica WHERE id_orden = $1', [idOrdenPrueba]);
      }
      console.log('\n🧹 Datos de prueba eliminados. La base de datos quedó como estaba.');
    } catch (e) {
      console.error('\n❌ IMPORTANTE: no se pudieron limpiar los datos de prueba automáticamente.');
      console.error(`   Bórralos manualmente: resultado.id_resultado=${idResultadoPrueba}, orden_medica.id_orden=${idOrdenPrueba}`);
      console.error('   Error:', e.message);
    }
  }
}

(async () => {
  console.log('═'.repeat(70));
  console.log(' DIAGNÓSTICO DE CRON JOBS — no espera a la hora programada');
  console.log('═'.repeat(70));

  try {
    await probarJob1();
    await probarJob2();
  } catch (e) {
    console.error('\n❌ Error general:', e.message);
  } finally {
    linea();
    console.log('Listo. Cerrando conexión...');
    await pool.end();
  }
})();