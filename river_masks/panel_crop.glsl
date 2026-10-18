// panel_crop.glsl — GLSL TOP pixel shader
// Samples 4 rotated rectangles from input 0 and writes each to its own color buffer.
// GLSL TOP setup:
//   Common page  -> Output Resolution: Custom = your LED panel resolution
//   GLSL page    -> # of Color Buffers: 4
//   Vectors page -> uRect0..uRect3 (center x, center y, width, height) in INPUT PIXELS
//                   uRot (x,y,z,w = rotation of rect 0..3, degrees, counter-clockwise)
// Pull buffers 1-3 out with Render Select TOPs (buffer 0 is the GLSL TOP's own output).

uniform vec4 uRect0;
uniform vec4 uRect1;
uniform vec4 uRect2;
uniform vec4 uRect3;
uniform vec4 uRot;

layout(location = 0) out vec4 fragColor[TD_NUM_COLOR_BUFFERS];

vec4 sampleRect(vec4 r, float deg)
{
    vec2 res   = uTD2DInfos[0].res.zw;          // input size in pixels
    vec2 local = (vUV.st - 0.5) * r.zw;         // offset from rect center, in pixels
    float a    = radians(deg);
    mat2 R     = mat2(cos(a), sin(a), -sin(a), cos(a));
    vec2 uv    = (r.xy + R * local) / res;      // back to input UV

    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0))))
        return vec4(0.0, 0.0, 0.0, 1.0);        // black outside the source
    return texture(sTD2DInputs[0], uv);
}

void main()
{
    fragColor[0] = TDOutputSwizzle(sampleRect(uRect0, uRot.x));
#if TD_NUM_COLOR_BUFFERS > 1
    fragColor[1] = TDOutputSwizzle(sampleRect(uRect1, uRot.y));
#endif
#if TD_NUM_COLOR_BUFFERS > 2
    fragColor[2] = TDOutputSwizzle(sampleRect(uRect2, uRot.z));
#endif
#if TD_NUM_COLOR_BUFFERS > 3
    fragColor[3] = TDOutputSwizzle(sampleRect(uRect3, uRot.w));
#endif
}
