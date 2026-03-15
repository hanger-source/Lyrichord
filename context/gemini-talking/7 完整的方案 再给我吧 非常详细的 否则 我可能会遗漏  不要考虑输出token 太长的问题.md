这是一份为您定制的、极其详尽的 **Lyrichord (歌弦)** 开源平台设计方案。

作为一名资深开发者，我们将采用“**领域特定语言 (DSL) + 工业级渲染引擎 + 采样合成器**”的架构。这个方案的核心是：**把感性的音乐节奏转化为理性的代码逻辑，并通过成熟的开源库进行缝合。**

---

## 1. 项目愿景与背景

* **定位**：一个文本驱动的吉他弹唱协作平台。
* **核心痛点**：解决图片谱“看不了节奏、听不到声音、改不了内容”的问题。
* **首测曲目**：陈柏宇《你瞒我瞒》（高阶情感阶梯版）。

---

## 2. 核心技术栈 (The "Frankenstein" Stack)

我们不造轮子，我们是轮子的组装者：

| 模块 | 选型 | 作用 |
| --- | --- | --- |
| **渲染引擎** | **AlphaTab** | **核心。** 负责将音符数据渲染为六线谱，处理排版、和弦图绘制。 |
| **音频合成** | **AlphaSynth** | AlphaTab 自带的合成器，支持加载 **SoundFont (.sf2)** 采样文件。 |
| **DSL 解析** | **Custom Parser (Regex/Peg.js)** | 将用户写的文本转换成 AlphaTab 的中间格式。 |
| **编辑器** | **Monaco Editor** | 提供语法高亮、自动补全（比如输入 `@` 提示节奏型）。 |
| **音频采样** | **Acoustic Guitar SF2** | 找一份 50MB 左右的高质量木吉他采样文件，确保听感真实。 |

---

## 3. 核心设计：Lyrichord DSL (领域特定语言)

我们要定义一套名为 **TabMarkdown (.tmd)** 的语法。它分为两个部分：**配置区**（定义节奏）和**演奏区**（关联歌词）。

### 3.1 节奏型模板 (Template Definition)

用户只需定义一次节奏，后面通过 ID 调用。

* `p`: 拇指 (4/5/6弦)
* `i, m, a`: 食指、中指、无名指
* `(ma)`: 同时拨动
* `D`: Down 扫弦, `U`: Up 扫弦, `X`: 呼吸留白/切音

```yaml
# 节奏型配置区
@R1: { bpm: 72, type: "pluck", pattern: "p i (ma) i" }
@R1Plus: { type: "pluck", pattern: "p i m a m i (ma) i" }
@R2A: { type: "strum", pattern: "D - - - | D - D U | X - - - | D - D U" }
@R2B: { type: "strum", pattern: "D - - - | D - D U | X U D U | D - D U" }

```

### 3.2 演奏内容区 (Performance Section)

```text
# 演奏内容区
[A1] @R1
(C)约会像是为(D)分享到饱肚滋(G)味
(C)有任何难(D)题却不提(Em)起

[B1] @R1Plus
(C)无言的亲亲(D)亲 侵袭我(G)心

[B2] @R2A
(C)无言的亲亲(D)亲 侵袭我(G)心 (转扫弦)

```

---

## 4. 系统架构与数据流转 (Detailed Flow)

### 第一步：DSL 语法解析 (Parser)

你需要写一个 `tmd-parser.js`。

1. **和弦解析**：识别 `(C)`，根据预设的 `ChordLibrary` 查找指法：`C -> {6:-1, 5:3, 4:2, 3:0, 2:1, 1:0}`。
2. **节奏展开**：这是最关键的。当解析器看到 `@R1` 时，它要将一个和弦展开成 4 个八分音符。
* 例如 `(C) @R1` 展开为：
1. 音符1: 5弦3品 (p)
2. 音符2: 3弦0品 (i)
3. 音符3: 2弦1品+1弦0品同时 (ma)
4. 音符4: 3弦0品 (i)





### 第二步：生成中间格式 (AlphaTex)

AlphaTab 并不直接读你的 DSL，它读一种叫 **AlphaTex** 的类 LaTeX 格式。你的解析器要生成这种字符串：

```latex
\title "你瞒我瞒"
\tempo 72
.
(3.5 2.4 0.3 1.2 0.1) 5.8 3.8 (1.8 0.8) 3.8 | (和弦+音符时值映射)

```

### 第三步：渲染与回放 (AlphaTab API)

```javascript
import alphaTab from '@coderline/alphatab';

const settings = {
    file: null, // 我们不传文件，传生成的字符串
    player: {
        enablePlayer: true,
        soundFont: '/sounds/acoustic_guitar.sf2' 
    }
};

const api = new alphaTab.AlphaTabApi(container, settings);

// 核心功能：当文本改变时同步更新
function onTextChange(tmdCode) {
    const alphaTex = myParser.convertToAlphaTex(tmdCode);
    api.tex(alphaTex); // 实时渲染出乐谱
}

// 自动播放
function playPreview() {
    api.play(); // 会按照你定义的 pattern 节奏发出真实吉他声
}

```

---

## 5. 针对《你瞒我瞒》的特别算法实现

为了实现你要求的“好听且精准”，系统需要处理几个细节：

### 5.1 低音自动寻迹 (Bass Tracking)

当遇到 `D/#F` 这种分数和弦时：

* 解析器需识别 `/` 后的字符。
* 在生成节奏型的第一个音（根音 `p`）时，强制指定在 **6弦 2品**，而不是 D 和弦默认的 4 弦。

### 5.2 扫弦的“呼吸感”逻辑 (The X Factor)

在解析 `@R2A` 时，遇到 `X`：

* 在 AlphaTex 中生成一个 **Rest (休止符)** 或者是带有 **Dead Note (闷音)** 标记的音符。
* 这会在音频回放时产生那个瞬间的安静，完美契合你要求的“留白”。

### 5.3 动力学映射 (Velocity Mapping)

* `@R1`（主歌）：设置 MIDI Velocity = 60 (轻柔)。
* `@R2B`（最后副歌）：设置 MIDI Velocity = 110 (激昂)。
* 这样即使是同一个采样，听起来也会有力度起伏。

---

## 6. 功能模块清单 (MVP Roadmap)

1. **编辑器模块**：双栏布局，左边输入 TMD 文本，右边是 AlphaTab 的 Canvas 渲染区。
2. **模板库模块**：内置常见节奏型（扫弦、分解、切音），支持用户自定义。
3. **播放控制条**：进度条、BPM 调节、音量调节、节拍器开关。
4. **导出模块**：一键生成 PDF（AlphaTab 自带功能）或分享短链接。

---

## 7. 避坑指南与性能建议

1. **Web Worker 渲染**：如果谱子很长，解析转换 DSL 会卡顿。建议把转换逻辑放在 Web Worker 里执行。
2. **SoundFont 懒加载**：SF2 文件很大，先让谱子出来，背景异步加载音色库。
3. **移动端适配**：AlphaTab 支持 `resize` 自动排版，但扫弦谱在手机横屏看效果最好。

---

## 8. 开源命名与 Slogan 建议

* **名字**：**Lyrichord (歌弦)**
* **Slogan**：*Write Lyrics, Play Chords, Hear the Soul.* (写下歌词，按下和弦，倾听灵魂。)

**这个方案避开了所有需要手动绘图、底层音频编程的坑，完全利用成熟库的 API 进行逻辑组装。您觉得这套“缝合”逻辑在实现上还有哪个环节觉得模糊吗？我可以为您提供具体的 `pattern` 到音符坐标的转换伪代码。**