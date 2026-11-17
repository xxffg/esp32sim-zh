> 本文是 esp32sim v0.4.0 官方文档的中文翻译，以[上游原文](https://github.com/mikroverk/esp32sim/blob/main/README.md)为准。

<p align="center">
  <img src="../assets/esp32sim-logo-icon.png" alt="esp32sim logo：模拟器窗口里一块微笑的芯片" width="240">
</p>

# esp32sim

esp32sim 是一个用 Rust 编写的 ESP32 模拟器。它不需要硬件，就能在你的电脑上或浏览器标签页里运行真实的 ESP32 固件。

它启动芯片自带 ROM（mask ROM）、真实的二级引导程序（bootloader），以及你未经修改的应用固件。它还模拟芯片周边的开发板：显示屏、触摸、LED、按键、音频、摄像头和 WiFi。

在浏览器里直接试用，无需安装：https://mikroverk.github.io/esp32sim/

`--chip esp32 --board ai-thinker-cam --cam-image image.ppm` 用一张 BMP 或 PPM 静态图片，为 AI-Thinker ESP32-CAM 的 OV2640 提供图像源。采集会把原始 RGB565/YUV422 写入内部 DRAM，帧率固定约 10 FPS。

常见的 JPEG+PSRAM CameraWebServer 路径不受支持。适用范围与示例见[摄像头一节](../esp32.md#the-camera---board-ai-thinker-cam)。

## 支持的芯片

| 芯片 | CPU | 状态 | 开发板 |
| --- | --- | --- | --- |
| ESP32-S3 | 2 x Xtensa LX7 | 成熟 | Atech 14 口套件、Waveshare Touch-LCD-4B、Touch-AMOLED-1.8、ESP32-S3-CAM、M5Stack StopWatch |
| ESP32-C3 | RISC-V RV32IMC | 草案 | 仅控制台 |
| ESP32-C6 | RISC-V RV32IMAC | 草案 | Waveshare ESP32-C6-LCD-1.47（带 802.15.4 射频）、Seeed XIAO ESP32-C6 |
| ESP32（经典款） | 2 x Xtensa LX6 | 早期 | LilyGO TTGO T-Display、ESP32-2432S028 "Cheap Yellow Display"、AI-Thinker ESP32-CAM（原始采集）、Ulanzi TC001 |
| ESP32-P4（rev < 3 与 rev ≥ 3） | 2 x RISC-V RV32IMAFC | 草案 | Waveshare ESP32-P4-WIFI6-Touch-LCD-3.5（rev ≥ 3）。WiFi 由 SDIO 上模拟的 ESP32-C6 协处理器提供（ESP-Hosted） |
| ESP32-S31 | 2 x RISC-V RV32IMAFC | 草案 | Espressif ESP-Mosaico（显示、触摸、WiFi、音频、IMU、按键）。IDF v6.1 |

## 特性

- 完整的启动链：芯片自带 ROM、引导程序、FreeRTOS，最后是你的应用固件。固件本身无需修改。
- WiFi：使用未经修改的 Espressif WiFi 库。固件扫描虚拟接入点及其周围的网络，加入其中一个后拿到 DHCP、DNS 和 NTP，还能访问真实网络（含 HTTPS）。站点的帧会写入 pcap 文件，或显示在页面的实时 Network 面板里。
- 开发板模型：固件可以在显示屏上绘图、读取触摸、点亮 LED 并播放声音。
- 速度：S3 带块缓存和 JIT，运行 hello_world 比实时快约 30 倍。
- WebAssembly：同一个模拟器另有浏览器构建。
- 与真实芯片的比对：S3 在 JTAG 上锁步运行，C3 和 C6 比对控制台输出。见[硬件测试](../hardware-testing.md)。

## 演示

以下内容运行在[演示站点](https://mikroverk.github.io/esp32sim/)上：

- ESP32-S3 上的 Linux 6.11（[svermigo/Linux-on-esp32-S3](https://github.com/svermigo/Linux-on-esp32-S3)），带登录 shell。
- Atech 套件上的 Pocket Synth 及其 C64 SID 点唱机（[atech-firmware](https://github.com/joakimeriksson/atech-firmware)）。
- 一块 480x480 的 LVGL 触摸面板，带 SID 播放器。
- [pocket-tank](https://github.com/mediacutlet/pocket-tank)：由一个小的 transformer 模型控制鱼的游向。
- ESP32-C6 上的 802.15.4 能量扫描器，以及两个运行 RPL/IPv6 的 Contiki-NG 节点。
- ESP32-C6 上的 WiFi 站点，加两个接入点及其周围的网络。它的帧实时显示在页面 Network 面板里。
- Seeed Studio XIAO ESP32-C6 的用户 LED 和 BOOT 按键。
- ESP32-P4 Touch-LCD-3.5 上的 Scintilla 合成器。P4 还能通过 ESP32-C6 协处理器接入 WiFi。
- ESP32-S31 ESP-Mosaico 圆形 AMOLED 上的指南针，含触摸、按键和马达。
- 经典 ESP32 T-Display 上的 MicroPython，以及一个 Schematik Arduino sketch。

你也可以为上述任何一颗芯片加载自己的固件。

## 快速开始

无需 Rust：[releases](https://github.com/mikroverk/esp32sim/releases) 提供 macOS 和 Linux 的预编译二进制。[quick-start.md](../quick-start.md) 用三步把你的构建从压缩包带到运行。从代码检出开始：

```sh
cargo build --release
tools/fetch-demo-assets.sh --no-linux       # downloads the mask ROMs, which are not in the repo

FW=web/wasm/fw/public                       # demo firmware included in the repo
./target/release/esp32sim --boot rom --rom web/wasm/fw/esp32s3_rev0_rom.elf \
    --bootloader $FW/atech-bootloader.bin --ptable $FW/atech-ptable.bin --app $FW/atech-firmware.bin \
    --script $FW/atech-script1.txt --wav out.wav --tft-png tft.png --max-seconds 5
```

这会启动 Atech 合成器固件，播放一段短脚本，把音频存到 `out.wav`，把显示内容存到 `tft.png`。其他芯片请用 `esp32sim-c3`、`esp32sim-c6`、`esp32sim-p4`、`esp32sim-s31` 或 `--chip esp32`。

[入门指南](../getting-started.md)介绍了其余内容：你自己的 ESP-IDF 构建、各款芯片、WiFi、脚本、浏览器构建和调试。

## 文档

- [快速开始](../quick-start.md)：安装发行版、获取芯片自带 ROM、运行你自己的构建、读懂结果
- [入门指南](../getting-started.md)：在各款芯片上运行固件、WiFi、脚本、浏览器构建
- [命令行参考](../cli.md)：所有参数、环境变量和输出文件
- [开发板](../boards.md)：每块开发板模拟了什么，以及如何添加一块
- [架构](../architecture.md)：模拟器怎样组织
- [外设](../peripherals.md)：模拟了哪些硬件模块，以及模拟到什么程度
- [硬件测试](../hardware-testing.md)：模拟器如何与真实芯片比对
- [全部文档](../README.md)：芯片笔记、设计决策和计划

## 参与贡献

欢迎 bug 修复、外设、开发板和新芯片。[CONTRIBUTING.md](../../CONTRIBUTING.md) 列出了 pull request 需要的检查，与 CI 运行的完全一致。安全问题请通过 [SECURITY.md](../../SECURITY.md) 报告，不要用公开的 issue 跟踪器。

## 致谢与许可

esp32sim 以 [MIT License](../../LICENSE) 发布。

作者：Joakim Eriksson、RISE（[@joakimeriksson](https://github.com/joakimeriksson)）、Alice（[@aliceisjustplaying](https://github.com/aliceisjustplaying)）、Mattia Fiumara、Schematik（[@mfiumara](https://github.com/mfiumara)），以及其他[贡献者](https://github.com/mikroverk/esp32sim/graphs/contributors)。

模拟器的依据有：ESP-IDF 的寄存器头文件、ESP-IDF 附带的 Xtensa 核心配置、RISC-V 规范，以及各芯片的技术参考手册。依据还包括观察到的固件行为。QEMU 只用于确认指令语义，没有复制任何代码。

esp32sim 是非官方项目，与 Espressif Systems 无隶属关系。

第三方代码、数据和演示文件保留各自的许可：

- pocket-tank（[mediacutlet/pocket-tank](https://github.com/mediacutlet/pocket-tank), MIT）。它的引导程序、分区表和应用固件位于 `web/wasm/fw/public/`，并附有 `pocket-tank-LICENSE.txt`。它的模型是下载得来的。
- MicroPython（[micropython.org](https://micropython.org/download/ESP32_GENERIC/), MIT）：T-Display 演示使用的官方 ESP32_GENERIC v1.29.0 镜像，由 `tools/fetch-micropython.sh` 下载，不在仓库中。演示的应用固件和文件系统位于 `examples/ttgo-tdisplay`，含 Russ Hughes 的 st7789py 驱动和字体（MIT）。声明见 `web/wasm/fw/public/tdisplay-NOTICE.txt`。
- Mask ROM ELF 文件（[espressif/esp-rom-elfs](https://github.com/espressif/esp-rom-elfs), Apache-2.0）：需下载，不在仓库中。
- xterm.js（[xtermjs/xterm.js](https://github.com/xtermjs/xterm.js), MIT）：需下载，不在仓库中。
- Linux 镜像（[svermigo/Linux-on-esp32-S3](https://github.com/svermigo/Linux-on-esp32-S3), GPL-3.0）：需下载，不在仓库中。
- ESP-IDF ADC 校准数据（Espressif, Apache-2.0）：曲线拟合系数和来自 #165 的 S3 ADC1 校准，位于 `esp-periph/src/sar_adc.rs`。见 `esp-periph/LICENSE-ADC`。
