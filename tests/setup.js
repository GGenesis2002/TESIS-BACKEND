/**
 * setup.js — Mocks globales para todas las pruebas
 */

// ── Variables de entorno ANTES de cualquier require ──────────────────────────
process.env.JWT_SECRET   = 'clave-secreta-para-pruebas';
process.env.DATABASE_URL = 'postgresql://fake:fake@localhost/fake';
process.env.NODE_ENV     = 'test';

// ── Mock del pool de PostgreSQL ───────────────────────────────────────────────
jest.mock('../src/config/db', () => {
    const mockClientQuery = jest.fn();
    const mockClient = {
        query:   mockClientQuery,
        release: jest.fn(),
    };
    const mockPoolQuery = jest.fn();
    const mockPool = {
        query:   mockPoolQuery,
        connect: jest.fn().mockResolvedValue(mockClient),
        on:      jest.fn(),
    };
    return mockPool;
});

// ── Mock del loginModule para controlar getUserByUsername directamente ─────────
jest.mock('../src/modules/loginModule', () => ({
    getUserByUsername: jest.fn(),
    recordAccess:      jest.fn().mockResolvedValue(undefined),
    recordFailure:     jest.fn().mockResolvedValue(undefined),
}));

// ── Mock de getConfig — evita depender del orden/caché real de pool.query ─────
// IMPORTANTE: ya no es necesario encolar mockResolvedValueOnce({ rows: CONFIG_ROWS })
// en cada test para "alimentar" a getConfig(). Esta función ahora siempre devuelve
// el objeto ya parseado, liberando los mocks de pool.query para las queries reales
// de cada endpoint (conteo de fallos, etc.)
// Estos valores deben reflejar la configuración real de configuracion_sistema en BD.
//
// IMPORTANTE: el módulo real exporta 3 funciones (getConfig, obtenerConfiguracion,
// actualizarConfiguracion). configuracionRoutes.js usa las dos últimas como
// middleware de Express directamente (router.get("/", verifyToken, obtenerConfiguracion)).
// Si el mock solo incluye getConfig, Express recibe `undefined` como handler y
// truena con "TypeError: argument handler must be a function" al cargar app.js
// (esto pasa al hacer require, antes de correr ningún test). Por eso deben
// mockearse las tres, aunque obtenerConfiguracion/actualizarConfiguracion no se
// usen en estas suites — solo necesitan ser funciones Express-válidas.
jest.mock('../src/controllers/configuracionController', () => ({
    getConfig: jest.fn().mockResolvedValue({
        expiracionQR:          48,
        bloqueoEdicion:        true,
        auditoriaEstricta:     true,
        notificarAlertasStock: true,
        reintentosLogin:       3,
    }),
    obtenerConfiguracion: jest.fn((req, res) => res.json({ status: 'success', data: {} })),
    actualizarConfiguracion: jest.fn((req, res) => res.json({ status: 'success', data: {} })),
}));

// ── Mock de Supabase Storage ──────────────────────────────────────────────────
jest.mock('../src/config/supabaseStorage', () => ({
    storage: {
        from: jest.fn().mockReturnValue({
            upload:         jest.fn().mockResolvedValue({ error: null }),
            download:       jest.fn().mockResolvedValue({ data: null, error: null }),
            remove:         jest.fn().mockResolvedValue({ error: null }),
            createSignedUrl: jest.fn().mockResolvedValue({
                data: { signedUrl: 'https://fake-url.com/firma.png' }, error: null,
            }),
            getPublicUrl: jest.fn().mockReturnValue({
                data: { publicUrl: 'https://fake-url.com/archivo.pdf' },
            }),
        }),
    },
}));

// ── Mock del servicio de correo ───────────────────────────────────────────────
jest.mock('../src/services/emailService', () => ({
    enviarCorreo: jest.fn().mockResolvedValue(true),
}));

// ── Mock de node-cron ─────────────────────────────────────────────────────────
jest.mock('node-cron', () => ({ schedule: jest.fn() }));

// ── Mock de QRCode ────────────────────────────────────────────────────────────
jest.mock('qrcode', () => ({
    toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,FAKEQR=='),
}));

// ── Mock de PDFKit ────────────────────────────────────────────────────────────
jest.mock('pdfkit', () => {
    return jest.fn().mockImplementation(() => ({
        on:       jest.fn(),
        end:      jest.fn(),
        fontSize: jest.fn().mockReturnThis(),
        font:     jest.fn().mockReturnThis(),
        text:     jest.fn().mockReturnThis(),
        image:    jest.fn().mockReturnThis(),
        rect:     jest.fn().mockReturnThis(),
        stroke:   jest.fn().mockReturnThis(),
        fill:     jest.fn().mockReturnThis(),
        fillColor: jest.fn().mockReturnThis(),
        moveTo:   jest.fn().mockReturnThis(),
        lineTo:   jest.fn().mockReturnThis(),
        lineWidth: jest.fn().mockReturnThis(),
        addPage:  jest.fn().mockReturnThis(),
    }));
});

// ─── Helpers globales ─────────────────────────────────────────────────────────
const jwt = require('jsonwebtoken');

global.generarToken = (overrides = {}) => {
    return jwt.sign(
        { id: 1, id_usuario_rol: 1, roles: ['Administrador'], ...overrides },
        process.env.JWT_SECRET,
        { expiresIn: '8h' }
    );
};

/** Acceso rápido al mock del pool */
global.mockPool = () => require('../src/config/db');

/** Acceso al cliente mockeado de transacciones */
global.getMockClient = async () => {
    const pool = require('../src/config/db');
    return pool.connect();
};

/** Config del sistema — reutilizable en todos los tests */
global.CONFIG_ROWS = [
    { clave: 'expiracionQR',          valor: '48',    tipo: 'number'  },
    { clave: 'bloqueoEdicion',        valor: 'true',  tipo: 'boolean' },
    { clave: 'auditoriaEstricta',     valor: 'true',  tipo: 'boolean' },
    { clave: 'notificarAlertasStock', valor: 'true',  tipo: 'boolean' },
    { clave: 'reintentosLogin',       valor: '3',     tipo: 'number'  },
];