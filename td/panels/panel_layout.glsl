// panel_layout.glsl: GLSL TOP pixel shader for /project1/panels/layout.
// Places up to four 256x128 quad images into the HDMI output that the Colorlight sender samples (top-left).
// Inputs: 0..3 = quads 1..4 (each already switched between canvas crop and test pattern); a file with two
// quads wires only two inputs.
// uQuad0..uQuad3 = (x, y, w, h) in output pixels, origin TOP-LEFT (as in Colorlight/LEDVision).
// uMode.x = 2 for black, uMode.y = brightness gain, uMode.z = 1 to blank quad 2.
//
// Sampler arrays are indexed with literal constants only, and only for inputs that exist.
// Sampling a missing input hung the Intel Iris Xe driver (TDR, 2026-10-18) and took TD down.

uniform vec4 uQuad0;
uniform vec4 uQuad1;
uniform vec4 uQuad2;
uniform vec4 uQuad3;
uniform vec4 uMode;

layout(location = 0) out vec4 fragColor;

// 0..1 position inside quad q (y down), or -1 when px is outside it
vec2 local(vec4 q, vec2 px)
{
    vec2 l = (px - q.xy) / q.zw;
    if (any(lessThan(l, vec2(0.0))) || any(greaterThanEqual(l, vec2(1.0))))
        return vec2(-1.0);
    return vec2(l.x, 1.0 - l.y);                // TD textures are y up
}

void main()
{
    vec2 res = uTDOutputInfo.res.zw;
    vec2 px  = vec2(vUV.s, 1.0 - vUV.t) * res;  // output pixel, origin top-left
    vec3 c = vec3(0.0);

#if TD_NUM_2D_INPUTS > 0
    vec2 a = local(uQuad0, px);
    if (a.x >= 0.0) c = texture(sTD2DInputs[0], a).rgb;
#endif
#if TD_NUM_2D_INPUTS > 1
    vec2 b = local(uQuad1, px);
    if (b.x >= 0.0 && uMode.z < 0.5) c = texture(sTD2DInputs[1], b).rgb;   // later quads win where they overlap
#endif
#if TD_NUM_2D_INPUTS > 2
    vec2 q3 = local(uQuad2, px);
    if (q3.x >= 0.0) c = texture(sTD2DInputs[2], q3).rgb;
#endif
#if TD_NUM_2D_INPUTS > 3
    vec2 q4 = local(uQuad3, px);
    if (q4.x >= 0.0) c = texture(sTD2DInputs[3], q4).rgb;
#endif

    if (uMode.x > 1.5) c = vec3(0.0);
    fragColor = TDOutputSwizzle(vec4(clamp(c * uMode.y, 0.0, 1.0), 1.0));
}
