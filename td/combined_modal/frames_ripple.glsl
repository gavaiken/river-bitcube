// frames_ripple.glsl: GLSL TOP pixel shader for /project1/viz/fr_<element>_out (Combined with Modal Input Selector).
// Modal Frames §6.3: out = target_colour_now x (1 + k (luma - mean_luma)), k = amount x contrast x 2 (uRipple.x).
// Inputs: 0 = the target colour now (Script TOP, from the OKLCH journey), 1 = the river's luma in this element's
// river_region (smoothed for river.speed < 1), 2 = that luma's mean (Analyze TOP, 1x1).
// Sampler arrays are indexed with literal constants only, and only for inputs that exist (an unwired sample hung the
// Intel Iris Xe driver on 2026-10-18; see panel_layout.glsl).
uniform vec4 uRipple;
layout(location = 0) out vec4 fragColor;

void main()
{
    vec3 c = vec3(0.0);
    float g = 1.0;
#if TD_NUM_2D_INPUTS > 0
    c = texture(sTD2DInputs[0], vUV.st).rgb;
#endif
#if TD_NUM_2D_INPUTS > 2
    float l = texture(sTD2DInputs[1], vUV.st).r;
    float m = texture(sTD2DInputs[2], vec2(0.5)).r;
    g = max(0.0, 1.0 + uRipple.x * (l - m));
#endif
    fragColor = TDOutputSwizzle(vec4(clamp(c * g, 0.0, 1.0), 1.0));
}
