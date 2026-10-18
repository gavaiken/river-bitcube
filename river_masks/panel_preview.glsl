// panel_preview.glsl — GLSL TOP pixel shader for placing the rects
// Shows the full input, dims everything outside the 4 rects, and draws colored outlines.
// GLSL TOP setup:
//   Common page  -> Output Resolution: Use Input
//   Vectors page -> same uRect0..uRect3 and uRot as panel_crop (reference the same params)
//                   uLine (x = outline thickness in pixels, e.g. 3)

uniform vec4 uRect0;
uniform vec4 uRect1;
uniform vec4 uRect2;
uniform vec4 uRect3;
uniform vec4 uRot;
uniform vec4 uLine;

layout(location = 0) out vec4 fragColor;

// signed distance-ish: <= 0 inside the rotated rect, > 0 outside
float rectDist(vec4 r, float deg, vec2 px)
{
    float a   = radians(deg);
    mat2 Rinv = mat2(cos(a), -sin(a), sin(a), cos(a));
    vec2 l    = Rinv * (px - r.xy);
    vec2 d    = abs(l) - r.zw * 0.5;
    return max(d.x, d.y);
}

void main()
{
    vec2 res = uTD2DInfos[0].res.zw;
    vec2 px  = vUV.st * res;
    vec4 col = texture(sTD2DInputs[0], vUV.st);

    float d[4];
    d[0] = rectDist(uRect0, uRot.x, px);
    d[1] = rectDist(uRect1, uRot.y, px);
    d[2] = rectDist(uRect2, uRot.z, px);
    d[3] = rectDist(uRect3, uRot.w, px);

    vec3 lineCol[4] = vec3[4](vec3(1,0.2,0.2), vec3(0.2,1,0.2),
                              vec3(0.3,0.5,1), vec3(1,0.9,0.2));

    bool inside = false;
    for (int i = 0; i < 4; i++) inside = inside || d[i] <= 0.0;
    if (!inside) col.rgb *= 0.3;

    for (int i = 0; i < 4; i++)
        if (d[i] <= 0.0 && d[i] > -uLine.x) col.rgb = lineCol[i];

    fragColor = TDOutputSwizzle(col);
}
