> 本文是 esp32sim v0.4.0 官方文档的中文翻译，以[上游原文](https://github.com/mikroverk/esp32sim/blob/main/docs/getting-started.md)为准。

# 入门指南

如何构建 esp32sim，并在各款芯片上运行固件。所有参数见[命令行参考](../cli.md)。如果你只有发行版压缩包、没有 Rust 工具链，简版说明在 [quick-start.md](../quick-start.md)。

- [芯片速览](#芯片速览)
- [构建并获取 ROM](#构建并获取-rom)
- [ESP32-S3](#esp32-s3)
- [ESP32-C3](#esp32-c3)
- [ESP32-C6](#esp32-c6)
- [经典 ESP32](#经典-esp32)
- [脚本：在模拟时间执行宿主机动作](#脚本在模拟时间执行宿主机动作)
- [WiFi](#wifi)
- [在浏览器中（WebAssembly）](#在浏览器中webassembly)
- [实时开发板 UI](#实时开发板-ui)
- [调试](#调试)
- [ESP32-S3 上的实时运行](#esp32-s3-上的实时运行)

## 芯片速览

| | ESP32-S3 | ESP32-C3 | ESP32-C6 |
| --- | --- | --- | --- |
| CPU | 2 x Xtensa LX7 @ 240 MHz | 1 x RISC-V RV32IMC @ 160 MHz | 1 x RISC-V RV32IMAC @ 160 MHz |
| 命令 | `esp32sim` | `esp32sim-c3` | `esp32sim-c6` |
| 核心 crate | `xtensa-lx7` | `riscv-rv32` | `riscv-rv32`（+ A 扩展） |
| 启动 | ROM、引导程序、FreeRTOS、应用固件 | ROM、引导程序、FreeRTOS、应用固件 | ROM、引导程序、FreeRTOS、应用固件 |
| 开发板 / 显示 | ST7735、ST7701S 480x480 + 触摸、WS2812、摄像头、音频 | 无，仅控制台 | SPI+DMA 上的 ST7789 172x320、WS2812、802.15.4 能量检测替身 |
| WiFi | 虚拟接入点、WPA2、DHCP/DNS/NTP、NAT 到真实网络、HTTPS | 同样的接入点和网络：扫描、WPA2、DHCP、NAT（一个站点） | 同上：扫描、WPA2、DHCP、NAT（一个站点，legacy 速率） |
| 速度 | 块解释器和 AArch64 JIT，约 150 到 240 Minsn/s | 解码后的基本块（EX265、#356），尚无 JIT；hello_world 远快于实时 | 同样的解码块 |
| 浏览器中 | 支持（WebAssembly） | 支持（WebAssembly） | 支持（WebAssembly） |
| 状态 | 成熟 | 草案，见 [esp32c3.md](../esp32c3.md) | 草案，见 [esp32c6.md](../esp32c6.md) |

经典 ESP32、ESP32-P4 和 ESP32-S31 在下面各有自己的小节，页面分别是 [esp32.md](../esp32.md)、[esp32p4.md](../esp32p4.md)、[esp32s31.md](../esp32s31.md)。每款芯片如何与真实硅片比对，见 [hardware-testing.md](../hardware-testing.md)。

大部分 SoC 是共享的。C3 原样复用 S3 的 UART、USB-Serial/JTAG、systimer、timer group、GPIO、SPI flash 控制器、GDMA 和 SHA/AES/RSA 模型，只加上自己的内存映射、缓存控制器和中断矩阵。C6 再次复用同样的模型，但有自己的一套内存映射、PLIC 前端、L1 缓存、PCR 和常开 LP 模块。

真正独立的只有 CPU crate。crate 布局见 [architecture.md](../architecture.md)。

## 构建并获取 ROM

```sh
cargo build --release
```

这会构建 `esp32sim`，它可以跑所有芯片（`--chip s3|c3|c6|esp32`），另外还有别名二进制 `esp32sim-c3` 和 `esp32sim-c6`。

每次运行都从芯片自带 ROM（mask ROM）的 ELF 启动，它由 Espressif 提供，未提交到仓库。如果装了 ESP-IDF，S3 的 ROM 会从 `~/.espressif/tools/esp-rom-elfs/*/esp32s3_rev0_rom.elf` 取用。没有 ESP-IDF 时：

```sh
tools/fetch-demo-assets.sh --no-linux      # the S3, C3 and C6 ROMs into web/wasm/fw/
```

然后传 `--rom web/wasm/fw/esp32s3_rev0_rom.elf`（或 C3/C6 对应的文件），或设置 `ESP32SIM_ROM_DIR=$PWD/web/wasm/fw`，测试也用它。给测试传绝对路径，因为 `cargo test` 在各自 crate 的目录下运行每个测试。

## ESP32-S3

### 演示固件

```sh
FW=web/wasm/fw/public                       # the demo images the goldens and the web page run
./target/release/esp32sim --boot rom \
    --bootloader $FW/atech-bootloader.bin --ptable $FW/atech-ptable.bin --app $FW/atech-firmware.bin \
    --script $FW/atech-script1.txt --wav out.wav --tft-png tft.png --max-seconds 5
```

这是 Atech 14 口套件的 Pocket Synth 固件，属于独立项目 [atech-firmware](https://github.com/joakimeriksson/atech-firmware)。它用 PlatformIO 构建，是 SID 合成器加 cRSID 播放器，能播放真实的 `.sid` 曲目。本仓库在 `web/wasm/fw/public/` 里带着它产出的镜像。

`--boot app` 跳过 ROM 和引导程序（bootloader），直接加载应用镜像。

### 你自己的 ESP-IDF 项目

例如 `examples/hello_world`，它是用 `idf.py set-target esp32s3 && idf.py build` 构建的 IDF 5.5 入门示例：

```sh
H=examples/hello_world/build
./target/release/esp32sim --board none --boot rom --console uart0 \
    --bootloader $H/bootloader/bootloader.bin --ptable $H/partition_table/partition-table.bin \
    --app $H/hello_world.bin --elf $H/hello_world.elf --elf $H/bootloader/bootloader.elf --max-seconds 26
```

它会在 UART0 上打印 ROM banner、引导程序和应用的日志、`Hello world!`，以及倒计时。之后它像真实硅片一样通过 RTC watchdog 重启（`rst:0xc (RTC_SW_CPU_RST)`），速度约为实时的 30 倍。

芯片复位（软件复位、RTC watchdog）会以正确的复位原因从 ROM 重启整台机器。`--no-reboot` 在第一次复位时就停止。

### 开发板

SoC 模型产生引脚级事件（GPIO 边沿、RMT 符号流、I2S 采样），由开发板模型来解释。用 `--board` 选择：

| `--board` | 开发板 |
| --- | --- |
| `atech14`（默认） | Atech 14 口套件：ST7735 显示、WS2812 灯环、编码器和按键 |
| `none` | 裸模块：任何 ESP32-S3 固件，仅控制台 |
| `waveshare-lcd4b` | Waveshare ESP32-S3-Touch-LCD-4B：经 LCD_CAM RGB 总线的 ST7701S 480x480、GT911 触摸、TCA9554、codec。可运行带触摸的 esp32-screen LVGL 面板 |
| `waveshare-amoled18-v2` | Waveshare ESP32-S3-Touch-AMOLED-1.8 V2：经 QSPI 的 CO5300 368x448、CST820 触摸 |
| `waveshare-cam` | Waveshare ESP32-S3-CAM-OV5640：CH32V003 IO 扩展器、经 SCCB 和 LCD_CAM DVP 端口的 OV5640、I2C0 上的 ES8311/ES7210 codec、I2S1 上的扬声器 |

`waveshare-cam` 开发板可以端到端跑 `waveshare-autopling` 固件，条件是 IDF 5.5、16 MB 闪存（flash）、8 MB octal PSRAM，参数 `--flash-mb 16 --psram-mb 8`。摄像头帧来自 `--cam-image`；在浏览器里则来自上传的图片或网络摄像头。

esp-dl 行人检测器跑在模拟的 PIE SIMD 单元上，检测到目标时会通过 ES8311 播放声音。见 `examples/waveshare-cam/`。

要添加开发板，实现 `BoardModel` trait（`gpio_changes`、`rmt_frame`、`i2c_devices`、`camera_frame` 等）。见 [boards.md](../boards.md)。

## ESP32-C3

`esp32sim-c3` 在模拟的 RISC-V 核心上运行未经修改的 ESP-IDF 固件，从真实的 mask ROM 经真实的引导程序进入 FreeRTOS。它接受与 `esp32sim` 相同的参数（`--trace`、`--break`、`--watch`、`--peek`、`--disasm`、`--log-periph`），打印 RISC-V 助记符时带上符号。

```sh
H=examples/hello_world-c3/build
./target/release/esp32sim-c3 --boot rom --flash-mb 4 \
    --bootloader $H/bootloader/bootloader.bin --ptable $H/partition_table/partition-table.bin \
    --app $H/hello_world.bin --elf $H/hello_world.elf --max-seconds 26
```

它会打印 ROM banner、引导程序日志、`Hello world!`，然后重启，一共三轮。

- `--mac`、`--reset-cause` 和 `--strap` 让一次运行采用真实开发板的身份，这样与该开发板的比对才有意义。
- WiFi 站点模式支持开放和 WPA2 虚拟接入点，带 DHCP 和 NAT。
- 没有开发板模型，也不支持 `--boot app`。

关于什么能用、什么不能用，以及硬件比对发现的五个模拟器 bug，见 [esp32c3.md](../esp32c3.md)。

## ESP32-C6

`esp32sim-c6` 是同一套前端放到 ESP32-C6 上：RV32IMAC、PLIC、统一的内存映射。

```sh
H=examples/hello_world-c6/build
./target/release/esp32sim-c6 --boot rom --flash-mb 4 \
    --bootloader $H/bootloader/bootloader.bin --ptable $H/partition_table/partition-table.bin \
    --app $H/hello_world.bin --elf $H/hello_world.elf --max-seconds 27
```

- `--board waveshare-c6-lcd147` 加入 Waveshare ESP32-C6-LCD-1.47：SPI2 和 GDMA 上的 ST7789、WS2812，以及 BOOT 按键。
- `--board xiao-esp32c6` 加入 Seeed Studio XIAO ESP32-C6：GPIO 15 上的低电平有效用户 LED、GPIO 9 上的 BOOT 按键，以及 RF 开关（`examples/xiao-esp32c6/`）。
- C6 的 802.15.4 MAC 会应答能量扫描，所以开发板上的 LVGL 频谱扫描固件可以端到端运行（`examples/waveshare-c6-lcd147/`）。该 MAC 也能按空口时序收发帧。
- `--cooja` 让 C6 成为 Cooja-NG 的外部 mote，通过 NDJSON 精确锁步驱动。未经修改的 Contiki-NG-on-IDF 镜像会与模拟的 MSP430 节点交换广播。
- `--wifi` 挂上与 S3 相同的虚拟接入点（见 [WiFi](#wifi)）。

见 [esp32c6.md](../esp32c6.md)。

## 经典 ESP32

经典 ESP32 在双 LX6 核心上启动自己的 ECO3 mask ROM，带 GPIO、UART 和定时器，用 `--chip esp32` 选择。`--board ttgo-tdisplay` 加入 LilyGO TTGO T-Display 的 ST7789 和按键。如何运行见 [esp32.md](../esp32.md)。

## ESP32-P4

`esp32sim-p4`（或 `--chip p4`）在两个 RISC-V 核心上启动 P4 的 mask ROM。硅片 rev < 3 和 rev ≥ 3 各有一套模型，CLI 从镜像判断修订版本。

```sh
FW=web/wasm/fw/public
./target/release/esp32sim-p4 --flash-mb 2 --bootloader $FW/p4-hello-bootloader.bin \
    --ptable $FW/p4-hello-ptable.bin --app $FW/p4-hello_world.bin --max-seconds 27
```

- `--board waveshare-p4-lcd35` 加入 Waveshare ESP32-P4-WIFI6-Touch-LCD-3.5（rev ≥ 3）：SPI 和 AXI-GDMA 上的 ST7796、FT5x06 触摸，以及 ES8311 codec。
- `--coproc c6:...` 让一个 ESP32-C6 在 SDIO 上锁步运行，使用未经修改的 ESP-Hosted slave，于是 P4 能像在真实开发板上那样接入 WiFi。
- `--sd IMG` 在 SD 插槽里放一张卡；`--usb-host F` 用脚本驱动 USB-OTG 端口。

见 [esp32p4.md](../esp32p4.md)。

## ESP32-S31

`esp32sim-s31`（或 `--chip s31`）在两个 RISC-V 核心上运行面向 ESP32-S31 的 ESP-IDF v6.1 固件。测试用的镜像在 `esp32s31/firmware`，可用 `tools/fetch-s31-firmware.sh` 重新构建：

```sh
F=esp32s31/firmware
./target/release/esp32sim-s31 --boot rom --bootloader $F/s31-hello-bootloader.bin \
    --ptable $F/s31-hello-ptable.bin --app $F/s31-hello_world.bin --max-seconds 5
```

- `--board mosaico` 加入 Espressif ESP-Mosaico：CO5300 480x480 AMOLED、CST9220 触摸、ES8311 codec 和麦克风、BMI270 和两颗 BMM150、AI 和 Boot 键，以及振动马达。`--imu-motion 1` 让开发板动起来，`--web PORT` 显示屏幕。页面里还能运行 `s31-mosaico` 演示，它是由 `examples/mosaico-demo` 构建的指南针。
- `--wifi` 挂上与其他芯片相同的虚拟接入点（WPA2、DHCP、NAT）。

见 [esp32s31.md](../esp32s31.md)，以及 [boards.md](../boards.md) 的 `mosaico` 一节。

## 脚本：在模拟时间执行宿主机动作

`--script FILE` 在给定的模拟时间执行动作：

```
1.5  press btn1 150                       # GPIO17 low for 150 ms
2.2  knob cw 2                            # two quadrature detents on CLK5/DT4
3.4  press btn2 120
4.0  serial {"action":"set_note","value":"9"}   # into USB-CDC RX
5.0  stop
```

## WiFi

WiFi 在 ESP32-S3、C3、C6 和经典 ESP32 上可用。

`--wifi ssid=NAME[,psk=PASS,chan=N,bssid=..]` 挂上一个虚拟接入点。未经修改的 Espressif WiFi blob 会与它关联：扫描、认证、关联，给了口令时再做 WPA2-PSK 四次握手。它背后是一个虚拟网络，带 DHCP、ARP、ICMP、DNS，以及取宿主机时钟的 SNTP。

`--net nat`（默认）通过普通宿主机 socket 中继客户机的 TCP 和 UDP，于是固件能到达真实网络；`--net none` 则拒绝。`--hostfwd tcp:127.0.0.1:8080-:80` 在宿主机上发布一个客户机 TCP 服务器。不用改固件、不用 root，也不需要 tun 设备。

```sh
./target/release/esp32sim --board waveshare-lcd4b --boot rom --flash-mb 16 --psram-mb 8 \
    --bootloader $P/bootloader/bootloader.bin --ptable $P/partition_table/partition-table.bin \
    --app $P/energy_panel.bin --console usb --wifi "ssid=home,psk=secret" --max-seconds 45
```

这会运行 esp32-screen 能源面板：它加入网络、拿到租约、同步时钟、通过 HTTPS 拉取两天的电价，并轮询局域网里真实的 Home Assistant。

ESP32-C6 通过自己的 MAC 模型加入同一个接入点和网络（[wifi-c6-plan.md](../wifi-c6-plan.md)）：一个站点、legacy 速率、无省电。样本是 `examples/c6-wifi-station`：扫描、加入、拿租约、五次 ping，并把状态显示在开发板屏幕上：

```sh
B=examples/c6-wifi-station/build-emu
./target/release/esp32sim-c6 --boot rom --flash-mb 4 --board waveshare-c6-lcd147 --console usb \
    --bootloader $B/bootloader/bootloader.bin --ptable $B/partition_table/partition-table.bin \
    --app $B/c6_wifi_station.bin --elf $B/c6_wifi_station.elf \
    --wifi ssid=esp32sim,psk=esp32sim-pass --max-seconds 14
```

ESP32-C3 也通过一个由 S3 派生的 MAC 模型加入同一个接入点。同一个站点示例按各芯片分别构建（不带显示），已作为 WiFi 基准输出（golden）的输入提交在 `web/wasm/fw/public/` 下，见 `cli/tests/goldens.rs` 中的 `wifi_station_{s3,c3,c6}`。所以无需本地构建即可运行：

```sh
P=web/wasm/fw/public
./target/release/esp32sim-c3 --boot rom --flash-mb 4 --console usb \
    --bootloader $P/c3-wifi-bootloader.bin --ptable $P/c3-wifi-ptable.bin --app $P/c3-wifi_station.bin \
    --wifi ssid=esp32sim,psk=esp32sim-pass --max-seconds 14
```

`examples/c6-radio-dashboard` 在一个固件里同时运行 WiFi 和 802.15.4 能量扫描，各占一页。

更多：

- [networking-howto.md](../networking-howto.md)：参数、调试和限制。
- [wifi-plan.md](../wifi-plan.md) 和 [networking-plan.md](../networking-plan.md)：MAC 模型和数据包路径如何工作。
- [architecture.md, Networking](../architecture.md#networking)：各芯片共享的层次。

## 在浏览器中（WebAssembly）

线上站点是 <https://mikroverk.github.io/esp32sim/>。要自己构建并提供服务：

```sh
tools/wasm-build.sh                  # the module -> web/wasm/esp32sim.wasm
tools/fetch-demo-assets.sh           # mask ROMs, xterm.js and the Linux image (--no-linux skips its 16 MB)
python3 -m http.server -d web 8790   # then open http://127.0.0.1:8790/?wasm&fw=hello
```

演示固件已提交。mask ROM、xterm.js 和 Linux 镜像没有提交，而每个演示都从 ROM 启动，所以先跑一次抓取。它拿到的正是 Pages 站点提供的同一批文件。

模拟器在页面里、一个 Web Worker 中运行。选一块开发板，从磁盘加载固件（或用 `?wasm&fw=<name>` 使用托管的 manifest），然后按 Boot。

ROM ELF 输入是可选的：留空时页面会获取站点自带的该芯片 mask ROM（`wasm/fw/<chip>_rom.elf`，上面的抓取会把它放在那里）。再次启动会替换机器，并保留已选的文件。

- hello_world、带 SID 播放器的 Touch-LCD-4B 面板、Atech 开发板、ESP32-C3 和 ESP32-C6 在 Chrome 里都能实时运行。
- 没有 NAT，因为浏览器没有 socket。
- S3 有自己的 WebAssembly JIT（热点块和区域，WASM SIMD 上的 PIE）。

见 [wasm.md](../wasm.md)。

## 实时开发板 UI

原生模拟器也能提供开发板 UI：

```sh
./target/release/esp32sim --boot rom --bootloader B.bin --ptable P.bin --app A.bin --web 8766
# open http://127.0.0.1:8766/
```

`--web PORT` 以实时速度运行模拟器，并提供 `web/run.html`。在 Atech 套件上它会显示：

- 14 口开发板：旋钮和 LED 环、按键、扬声器 VU 表，以及按物理方向摆放的 ST7735 和一份可读的副本。
- USB-CDC 和 UART0 控制台，以及用于 SDK JSON 协议的动作框。
- 通过 WebAudio 播放的音频。

点按键，用鼠标滚轮、拖动或左右方向键转旋钮，点盖子把它按下。协议说明见 [web-ui.md](../web-ui.md)。

## 调试

| 参数 | 作用 |
| --- | --- |
| `--trace [--trace-from N]` | 跟踪指令 |
| `--break ADDR` | 在某个地址停止 |
| `--watch ADDR` | 某个字变化时停止 |
| `--peek ADDR[,N]` | 运行结束时打印内存 |
| `--profile` | PC 直方图 |
| `--log-periph` | 记录对每个未知寄存器的首次访问 |
| `--stop-after-exceptions N` | N 次异常后停止 |
| `--gram-png` | 转储原始 ST7735 GRAM |
| `--no-jit` | 用解释器代替本地代码；两者必须给出相同结果 |

环境变量：`ESP_EMU_DEBUG`、`ESP_EMU_DEBUG_SPI`、`ESP_EMU_DEBUG_USB`、`ESP_EMU_DEBUG_WIFI[_FRAMES]`、`ESP_EMU_DEBUG_NET`、`ESP_EMU_DEBUG_AES`、`ESP_EMU_DEBUG_SHA`、`ESP_EMU_DEBUG_RSA`。

## ESP32-S3 上的实时运行

指令块只解码一次，之后从缓存执行，再编译成本地 AArch64 代码。空闲核心（`waiti`）被跳过，设备时间按算出的定时器截止时间延迟投递，中断线只在来源变化时重算。每一步背后的测量见 [speed-plan.md](../speed-plan.md)。

Pocket Synth 固件在空闲或弹奏时以有余量的实时速度运行。唯一跟不上的是整屏重绘：此时核心 1 有 100% 的时间在 bit-bang SPI，每 20 ms 480 万条指令，需要 240 Minsn/s，而在 M 系列 MacBook 上实际约为 70 Minsn/s。所以每次重绘会带来约 0.3 s 的延迟：

- UI 的自适应音频缓冲会吸收它（欠载时增长，最多 400 ms），pacer 之后会恢复。
- 模拟器落后超过 0.5 s 时，它会重新同步，而不是猛追补上。
- 页头会显示 `real time`、`⚠ N s behind` 和重新同步次数。

`ESP_EMU_RT_LOG=1` 会打印每个墙钟耗时超过 40 ms 的 20 ms 窗口，含两个核心的指令数和 PC。`hw/wsdrive.py [port] [seconds]` 不打开浏览器也能驱动 UI 协议（按键和旋钮），并报告推送间隔、延迟和已投递的音频。用它来测量调度器的改动。
