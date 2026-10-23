// panel_pair.glsl: GLSL TOP pixel shader for /project1/panels/quad34 (four-quad files only).
// Joins quad 3 (input 0) and quad 4 (input 1) into one image, because a GLSL TOP takes at most 3 inputs in
// this TouchDesigner build: the layout gets quad 1, quad 2 and this pair. uStack.x = 0: side by side
// (512x128, quad 4 right of quad 3); 1: stacked (256x256, quad 4 below quad 3, as the Gray Area receive card
// has it, 23 Oct). Inputs are sampled with literal indices, only if they exist (see panel_layout.glsl).
uniform vec4 uStack;
layout(location = 0) out vec4 fragColor;

void main()
{
    vec3 c = vec3(0.0);
    vec2 uv = vUV.st;
    bool stacked = uStack.x > 0.5;
    bool first = stacked ? uv.y >= 0.5 : uv.x < 0.5;            // TD textures are y up: quad 3 is the top half
    vec2 l = stacked ? vec2(uv.x, (uv.y - (first ? 0.5 : 0.0)) * 2.0)
                     : vec2((uv.x - (first ? 0.0 : 0.5)) * 2.0, uv.y);
    if (first) {
#if TD_NUM_2D_INPUTS > 0
        c = texture(sTD2DInputs[0], l).rgb;
#endif
    } else {
#if TD_NUM_2D_INPUTS > 1
        c = texture(sTD2DInputs[1], l).rgb;
#endif
    }
    fragColor = TDOutputSwizzle(vec4(c, 1.0));
}
