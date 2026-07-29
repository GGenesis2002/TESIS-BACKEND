// ─── documento.routes.js ────────────────────────────────────────────────────
// Endpoint GRATUITO para autocompletar nombres a partir de la cédula.
//
// Usa el servicio público del SRI (el mismo que usa su propio sitio web para
// consultar RUC). Es gratis y no requiere convenio, PERO:
//
//   1) Solo funciona para CÉDULA (no pasaporte).
//   2) Solo devuelve datos si esa persona tiene un RUC registrado en el SRI
//      (en la práctica, casi todo adulto con cédula lo tiene generado
//      automáticamente, pero puede fallar en menores de edad o personas que
//      nunca han tenido actividad económica).
//   3) Solo trae el NOMBRE COMPLETO (razón social). NO trae fecha de
//      nacimiento, dirección, ni otros datos — eso solo lo tiene el
//      Registro Civil (DIGERCIC) mediante convenio institucional.
//   4) Es un endpoint NO documentado oficialmente (lo usa el propio portal
//      del SRI puertas adentro). Puede cambiar o dejar de funcionar sin
//      aviso; no debe ser tu única fuente de verdad. Siempre deja los
//      campos editables para que el usuario corrija si hace falta.
//
// Agrega esto a tu backend, por ejemplo como routes/documento.routes.js,
// y móntalo en tu app principal con:
//   app.use("/documento", require("./routes/documento.routes"));
const { verifyToken } = require("../middlewares/authMiddleware");

const express = require("express");
const axios = require("axios");
const router = express.Router();

const SRI_URL =
  "https://srienlinea.sri.gob.ec/sri-catastro-sujeto-servicio-internet/rest/ConsolidadoContribuyente/obtenerPorNumerosRuc";

// Convierte "PEREZ GOMEZ MARIA JOSE" en { apellidos: "PEREZ GOMEZ", nombres: "MARIA JOSE" }
// Es una heurística (en Ecuador el orden habitual es apellido+apellido+nombre+nombre),
// así que SIEMPRE debe quedar editable en el formulario del frontend.
function separarNombreCompleto(razonSocial) {
  const palabras = (razonSocial || "").trim().split(/\s+/);
  if (palabras.length < 2) return { nombres: razonSocial || "", apellidos: "" };
  const mitad = Math.ceil(palabras.length / 2);
  return {
    apellidos: palabras.slice(0, mitad).join(" "),
    nombres: palabras.slice(mitad).join(" "),
  };
}

router.get("/consultar/:cedula", verifyToken, async (req, res) => {
  const { cedula } = req.params;

  if (!/^\d{10}$/.test(cedula)) {
    return res.status(400).json({ error: "La cédula debe tener exactamente 10 dígitos." });
  }

  const ruc = `${cedula}001`; // RUC de persona natural = cédula + 001

  try {
    const { data } = await axios.get(SRI_URL, {
      params: { ruc },
      timeout: 8000,
      headers: { "Content-Type": "application/json; charset=UTF-8" },
    });

    const contribuyente = Array.isArray(data) ? data[0] : data;

    if (!contribuyente || !contribuyente.razonSocial) {
      return res.status(404).json({
        error: "No se encontraron datos públicos para esta cédula. Ingresa los datos manualmente.",
      });
    }

    const { nombres, apellidos } = separarNombreCompleto(contribuyente.razonSocial);

    return res.json({
      encontrado: true,
      razonSocial: contribuyente.razonSocial,
      nombres,
      apellidos,
    });
  } catch (err) {
    console.error("Error consultando el SRI:", err.message);
    return res.status(502).json({
      error: "No se pudo consultar el servicio del SRI en este momento. Intenta de nuevo o ingresa los datos manualmente.",
    });
  }
});

module.exports = router;
