// panel_test.glsl: GLSL TOP pixel shader, a 256x128 identification pattern for one 2x2 panel quad.
// Panels (128x64 each): top-left red, top-right green, bottom-left blue, bottom-right yellow,
// each with a 1 px white border. Quad number = count of white squares in the top-left panel.
// Optional (uQuad.z = 1): a full-height white bar sweeps left to right once per second to show
// motion/frame drops. Off by default: in a photo it looks like an extra panel border.
// uQuad.x = quad number (1, 2, ...), uQuad.y = time in seconds, uQuad.z = sweep on.

uniform vec4 uQuad;

layout(location = 0) out vec4 fragColor;

void main()
{
    vec2 px = floor(vec2(vUV.s, 1.0 - vUV.t) * vec2(256.0, 128.0));   // top-left origin
    vec2 cell = floor(px / vec2(128.0, 64.0));
    vec2 inner = px - cell * vec2(128.0, 64.0);
    int panel = int(cell.x + 2.0 * cell.y);
    vec3 cols[4] = vec3[4](vec3(1,0,0), vec3(0,1,0), vec3(0,0.3,1), vec3(1,0.8,0));
    vec3 c = cols[panel] * 0.35;

    if (inner.x < 1.0 || inner.y < 1.0 || inner.x > 126.0 || inner.y > 62.0) c = vec3(1.0);

    // quad number: N 10x10 squares along the top-left panel, 6 px gaps
    if (panel == 0 && inner.y >= 8.0 && inner.y < 18.0) {
        float i = floor((inner.x - 8.0) / 16.0);
        if (inner.x >= 8.0 && i < uQuad.x && mod(inner.x - 8.0, 16.0) < 10.0) c = vec3(1.0);
    }

    float sweep = floor(fract(uQuad.y) * 256.0);
    if (uQuad.z > 0.5 && abs(px.x - sweep) < 1.5) c = vec3(1.0);

    fragColor = TDOutputSwizzle(vec4(c, 1.0));
}
