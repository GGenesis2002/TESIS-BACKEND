// config/roles.js
//
// ⚠️ IMPORTANTE: estos strings deben coincidir EXACTAMENTE (mayúsculas y tildes)
// con el valor que guarda tu tabla `rol` en la base de datos, porque
// checkRole() en authMiddleware.js compara con .includes() de forma literal.
//
// Revisa tu tabla `rol` (SELECT nombre_rol FROM rol) y ajusta estos valores
// si difieren. Luego todos los archivos de rutas importan de aquí, así que
// solo tienes que corregirlo en un solo lugar.

module.exports = {
    ADMIN:        'Administrador',
    TECNICO:      'Técnico',         
    ESPECIALISTA: 'Especialista',
    ASISTENTE:    'Asistente Analista', 
    PACIENTE:     'Paciente',
};