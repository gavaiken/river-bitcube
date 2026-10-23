// panel_pair.glsl: GLSL TOP pixel shader for /project1/panels/quad34 (four-quad files only).
// Puts quad 3 (input 0) and quad 4 (input 1) side by side in one 512x128 image, because a GLSL TOP takes at
// most 3 inputs in this TouchDesigner build: the layout gets quad 1, quad 2 and this pair (quad 4 always sits
// directly right of quad 3). Inputs are sampled with literal indices, only if they exist (see panel_layout.glsl).
layout(location = 0) out vec4 fragColor;

void main()
{
    vec3 c = vec3(0.0);
    vec2 uv = vUV.st;
    if (uv.x < 0.5) {
#if TD_NUM_2D_INPUTS > 0
        c = texture(sTD2DInputs[0], vec2(uv.x * 2.0, uv.y)).rgb;
#endif
    } else {
#if TD_NUM_2D_INPUTS > 1
        c = texture(sTD2DInputs[1], vec2((uv.x - 0.5) * 2.0, uv.y)).rgb;
#endif
    }
    fragColor = TDOutputSwizzle(vec4(c, 1.0));
}
