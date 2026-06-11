/**
 * CBD Sum Junction Shape Plugin for draw.io
 *
 * [등록 방법]
 *   draw.io Desktop : Extras > Plugins > Add > 이 파일 선택 > 재시작
 *   diagrams.net 웹 : Extras > Plugins > Add > 파일 경로/URL 입력 > 재시작
 *   VS Code (hediet.vscode-drawio) :
 *     .vscode/settings.json 에 추가:
 *     "hediet.vscode-drawio.plugins": [{ "file": "${workspaceFolder}/drawio-plugins/sum-junction.js" }]
 *
 * [shape 스타일 키]
 *   shape   = cbdSumJunction   (필수)
 *   inputs  = 2 | 3 | 4        (입력 수, 기본값: 2)
 *   signs   = +,+,-,+          (각 입력 부호, 쉼표 구분, 기본값: +,+)
 *   output  = east | north     (출력 방향, 기본값: east)
 *
 * [Connection Constraint 순서]
 *   [0] = 출력 포트
 *   [1] ~ [n] = 입력 포트 (위→아래, 왼→오른 순서)
 *
 * [사용 예시]
 *   shape=cbdSumJunction;inputs=3;signs=+,-,+;output=east;
 */

Draw.loadPlugin(function (ui) {

  // ──────────────────────────────────────────────
  // Shape 클래스 정의
  // ──────────────────────────────────────────────
  function SumJunctionShape(bounds, fill, stroke, strokewidth) {
    mxShape.call(this, bounds, fill, stroke, strokewidth);
  }
  mxUtils.extend(SumJunctionShape, mxShape);

  /**
   * 배경: 원 그리기
   */
  SumJunctionShape.prototype.paintBackground = function (c, x, y, w, h) {
    c.ellipse(x, y, w, h);
    c.fillAndStroke();
  };

  /**
   * 전경: Σ 기호 + 입력 부호(+/-) 텍스트
   */
  SumJunctionShape.prototype.paintForeground = function (c, x, y, w, h) {
    var inputs   = parseInt(mxUtils.getValue(this.style, 'inputs',  '2'), 10);
    var signsRaw = mxUtils.getValue(this.style, 'signs',  '+,+');
    var signs    = signsRaw.split(',');
    var output   = mxUtils.getValue(this.style, 'output', 'east');
    var fgColor  = mxUtils.getValue(this.style, 'strokeColor', '#000000');

    var cx = x + w / 2;
    var cy = y + h / 2;
    var r  = Math.min(w, h) / 2;

    c.setFontColor(fgColor);

    // 중앙 Σ 기호
    c.setFontSize(Math.max(10, r * 0.45));
    c.setFontStyle(1); // bold
    c.text(cx, cy, 0, 0, '\u03A3',
      mxConstants.ALIGN_CENTER, mxConstants.ALIGN_MIDDLE,
      0, null, 0, 0, 0);

    // 각 입력 포트 부호
    var inputPts = this._getInputPoints(x, y, w, h, inputs, output);
    c.setFontSize(Math.max(8, r * 0.3));
    c.setFontStyle(1);

    for (var i = 0; i < inputPts.length; i++) {
      var pt   = inputPts[i];
      var sign = (signs[i] !== undefined) ? signs[i].trim() : '+';
      // 원 중심과 포트 사이 55% 지점에 표시
      var tx = cx + (pt.x - cx) * 0.55;
      var ty = cy + (pt.y - cy) * 0.55;
      c.text(tx, ty, 0, 0, sign,
        mxConstants.ALIGN_CENTER, mxConstants.ALIGN_MIDDLE,
        0, null, 0, 0, 0);
    }
  };

  /**
   * 입력 포트 절대 좌표 반환
   * output='east' : 출력=오른쪽, 입력=왼쪽/위쪽/아래쪽
   * output='north': 출력=위쪽,   입력=왼쪽/오른쪽/아래쪽
   */
  SumJunctionShape.prototype._getInputPoints = function (x, y, w, h, inputs, output) {
    var cx = x + w / 2;
    var cy = y + h / 2;
    var pts = [];

    if (output === 'east') {
      switch (inputs) {
        case 2:
          pts.push({ x: x,  y: cy });          // West
          pts.push({ x: cx, y: y + h });        // South
          break;
        case 3:
          pts.push({ x: x,  y: cy });           // West
          pts.push({ x: cx, y: y });            // North
          pts.push({ x: cx, y: y + h });        // South
          break;
        case 4:
        default:
          pts.push({ x: x,  y: cy - h * 0.25 }); // West-upper
          pts.push({ x: x,  y: cy + h * 0.25 }); // West-lower
          pts.push({ x: cx, y: y });               // North
          pts.push({ x: cx, y: y + h });           // South
          break;
      }
    } else { // north
      switch (inputs) {
        case 2:
          pts.push({ x: x,     y: cy });        // West
          pts.push({ x: x + w, y: cy });        // East
          break;
        case 3:
          pts.push({ x: x,     y: cy });        // West
          pts.push({ x: x + w, y: cy });        // East
          pts.push({ x: cx,    y: y + h });     // South
          break;
        case 4:
        default:
          pts.push({ x: x,     y: cy - h * 0.25 }); // West-upper
          pts.push({ x: x,     y: cy + h * 0.25 }); // West-lower
          pts.push({ x: x + w, y: cy });              // East
          pts.push({ x: cx,    y: y + h });           // South
          break;
      }
    }
    return pts;
  };

  /**
   * Connection Constraints (연결 포트 위치)
   * 순서: [0]=출력, [1..n]=입력
   */
  SumJunctionShape.prototype.getConstraints = function (style, w, h) {
    var cs     = [];
    var inputs = parseInt(mxUtils.getValue(style, 'inputs',  '2'), 10);
    var output = mxUtils.getValue(style, 'output', 'east');

    // ── 출력 포트 ──
    if (output === 'east') {
      cs.push(new mxConnectionConstraint(new mxPoint(1,   0.5), true));
    } else { // north
      cs.push(new mxConnectionConstraint(new mxPoint(0.5, 0  ), true));
    }

    // ── 입력 포트 ──
    if (output === 'east') {
      switch (inputs) {
        case 2:
          cs.push(new mxConnectionConstraint(new mxPoint(0,   0.5 ), true));
          cs.push(new mxConnectionConstraint(new mxPoint(0.5, 1   ), true));
          break;
        case 3:
          cs.push(new mxConnectionConstraint(new mxPoint(0,   0.5 ), true));
          cs.push(new mxConnectionConstraint(new mxPoint(0.5, 0   ), true));
          cs.push(new mxConnectionConstraint(new mxPoint(0.5, 1   ), true));
          break;
        case 4:
        default:
          cs.push(new mxConnectionConstraint(new mxPoint(0,   0.25), true));
          cs.push(new mxConnectionConstraint(new mxPoint(0,   0.75), true));
          cs.push(new mxConnectionConstraint(new mxPoint(0.5, 0   ), true));
          cs.push(new mxConnectionConstraint(new mxPoint(0.5, 1   ), true));
          break;
      }
    } else { // north
      switch (inputs) {
        case 2:
          cs.push(new mxConnectionConstraint(new mxPoint(0,   0.5 ), true));
          cs.push(new mxConnectionConstraint(new mxPoint(1,   0.5 ), true));
          break;
        case 3:
          cs.push(new mxConnectionConstraint(new mxPoint(0,   0.5 ), true));
          cs.push(new mxConnectionConstraint(new mxPoint(1,   0.5 ), true));
          cs.push(new mxConnectionConstraint(new mxPoint(0.5, 1   ), true));
          break;
        case 4:
        default:
          cs.push(new mxConnectionConstraint(new mxPoint(0,   0.25), true));
          cs.push(new mxConnectionConstraint(new mxPoint(0,   0.75), true));
          cs.push(new mxConnectionConstraint(new mxPoint(1,   0.5 ), true));
          cs.push(new mxConnectionConstraint(new mxPoint(0.5, 1   ), true));
          break;
      }
    }

    return cs;
  };

  // ──────────────────────────────────────────────
  // Shape 등록
  // ──────────────────────────────────────────────
  mxCellRenderer.registerShape('cbdSumJunction', SumJunctionShape);

  console.log('[CBD Plugin] cbdSumJunction shape registered.');
});
