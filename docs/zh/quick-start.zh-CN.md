> 本文是 esp32sim v0.4.0 官方文档的中文翻译，以[上游原文](https://github.com/mikroverk/esp32sim/blob/main/docs/quick-start.md)为准。

# 快速开始

三步让固件在模拟器里跑起来：安装、取芯片自带 ROM、运行。后文再说明几个常用参数的含义，以及跑不通时去哪里找答案。所有参数见[命令行参考](../cli.md)，每款芯片在 [getting-started.md](../getting-started.md) 里都有单独一节。

本页的内容都不需要 Rust 工具链，也不需要检出本仓库。

- [1. 安装](#1-安装)
- [2. 获取 mask ROM](#2-获取-mask-rom)
- [3. 运行你的构建](#3-运行你的构建)
- [改用浏览器](#改用浏览器)
- [读懂运行结果](#读懂运行结果)
- [操控它：脚本、WiFi 与浏览器里的开发板](#操控它脚本wifi-与浏览器里的开发板)
- [跑不通的时候](#跑不通的时候)

## 1. 安装

从[发布页](https://github.com/mikroverk/esp32sim/releases)下载适合你机器的压缩包（macOS Apple silicon、Linux x86_64、Linux arm64），然后解压：

```sh
tar xzf esp32sim-*.tar.gz
cd esp32sim-*/
./esp32sim --version
```

压缩包里有 `esp32sim`，用它跑所有芯片（`--chip esp32|s3|c3|c6|p4|s31`，默认 S3）。还有四个别名：`esp32sim-c3`、`esp32sim-c6`、`esp32sim-p4` 和 `esp32sim-s31`。包里还有本页、命令行参考、入门指南和 `tools/fetch-rom-elfs.sh`。

把这个目录加入 `PATH`，或按路径调用这些二进制；下面的示例假设它们就在当前目录。

在 macOS 上，首次启动下载来的二进制可能被 Gatekeeper 拒绝，提示「cannot be opened because the developer cannot be verified」。可以在「系统设置 → 隐私与安全性」里放行，或执行 `xattr -d com.apple.quarantine esp32sim esp32sim-c3 esp32sim-c6 esp32sim-p4 esp32sim-s31`。

从源码构建也可以：在代码检出里执行 `cargo build --release`，会在 `target/release/` 里生成同样的五个二进制。

## 2. 获取 mask ROM

每次运行都会启动芯片自带 ROM（mask ROM），与真实硅片一致。ROM 由 Espressif 提供（Apache-2.0，[espressif/esp-rom-elfs](https://github.com/espressif/esp-rom-elfs)），不在压缩包里。一条命令即可获取全部五个，并用 SHA-256 固定版本：

```sh
tools/fetch-rom-elfs.sh roms
```

然后有两种做法：每次运行传 `--rom roms/<chip>_rom.elf`，或一次性设好目录：

```sh
export ESP32SIM_ROM_DIR=$PWD/roms
```

| 芯片 | ROM 文件 |
| --- | --- |
| ESP32-S3 | `esp32s3_rev0_rom.elf` |
| ESP32-C3 | `esp32c3_rev3_rom.elf` |
| ESP32-C6 | `esp32c6_rev0_rom.elf` |
| ESP32（经典款） | `esp32_rev300_rom.elf` |
| ESP32-P4 rev < 3 / rev ≥ 3 | `esp32p4_rev0_rom.elf` / `esp32p4_rev300_rom.elf` |
| ESP32-S31 | `esp32s31_rev0_rom.elf` |

如果装了 ESP-IDF，ROM 会自动在 `~/.espressif/tools/esp-rom-elfs/` 下找到。没有 ROM 时，模拟器立即停止，并报 `没找到 <chip> 的 mask ROM ELF(请传 --rom,或改用 --boot app)`。

## 3. 运行你的构建

固件照常构建：ESP-IDF、PlatformIO 或 Arduino 都行，不需要改。构建目录里有模拟器需要的三个镜像，以及提供符号的 ELF：

```
build/bootloader/bootloader.bin
build/partition_table/partition-table.bin
build/<app>.bin
build/<app>.elf
```

以 ESP32-S3 为例（`idf.py set-target esp32s3 build`）：

```sh
H=path/to/your/project/build
./esp32sim --board none --boot rom --console uart0 \
    --bootloader $H/bootloader/bootloader.bin --ptable $H/partition_table/partition-table.bin \
    --app $H/my_app.bin --elf $H/my_app.elf --max-seconds 10 --no-dump
```

ROM banner、引导程序（bootloader）日志和应用输出会像在 UART0 上那样出现在控制台。跑满 10 秒模拟时间后运行自行停止，并打印报告。`--board none` 表示裸模块：什么固件都能跑，但只有控制台；开发板列表见[命令行参考](../cli.md#images-and-boot)的 `--board` 一节。

其他芯片用同样的参数。C3 和 C6 默认 4 MB 闪存（flash）和 UART0；P4 为 16 MB，S31 为 2 MB，加 `--board mosaico` 时 S31 为 16 MB：

```sh
./esp32sim-c3 --boot rom --bootloader $H/bootloader/bootloader.bin \
    --ptable $H/partition_table/partition-table.bin --app $H/my_app.bin --elf $H/my_app.elf --max-seconds 10
./esp32sim-c6 --boot rom --bootloader $H/bootloader/bootloader.bin \
    --ptable $H/partition_table/partition-table.bin --app $H/my_app.bin --elf $H/my_app.elf --max-seconds 10
./esp32sim --chip esp32 --board esp32dev --boot rom --bootloader $H/bootloader/bootloader.bin \
    --ptable $H/partition_table/partition-table.bin --app $H/my_app.bin --elf $H/my_app.elf --max-seconds 10
```

flash 和 PSRAM 容量要跟模块对上。16 MB / 8 MB 的 S3 模块用 `--flash-mb 16 --psram-mb 8`，而 S3 默认 8 / 2。

PlatformIO 把同样的三个文件放在 `.pio/build/<env>/` 下。Arduino 的导出（`Sketch → Export compiled binary`）会给出 `<sketch>.ino.bootloader.bin`、`<sketch>.ino.partitions.bin` 和 `<sketch>.ino.bin`，分别对应同样三个参数。整个 flash 转储（`esptool read_flash`）则用 `--flash-image F` 代替这三个镜像。

一定要给出上限（`--max-seconds S` 或 `--max-insns N`）。这样运行会自行返回，每次结果都相同，精细到指令数。

## 改用浏览器

同一个模拟器也能在浏览器标签页里运行：**<https://mikroverk.github.io/esp32sim/>**。点 *Configure a machine*，选一块开发板，再选你的 `bootloader.bin`、`partition-table.bin` 和应用固件。

*ROM ELF* 留空即可，页面会用站点自带的该芯片 ROM。不会上传任何内容；这些文件由你浏览器里的页面读取。改完文件再次启动，机器会被替换，已选的文件保持不变。

浏览器没有 socket，所以 WiFi 能连上虚拟接入点，却到不了真实网络。浏览器里也没有原生 JIT：hello_world 和显示类演示按实时速度运行，重负载会更慢。

## 读懂运行结果

控制台是固件自己打印的内容。其余信息靠那些在运行结束报告里留下文件或几行输出的参数：

| 想要 | 参数 |
| --- | --- |
| 固件画出的显示画面 | `--tft-png frame.png` |
| 固件播放的音频 | `--wav out.wav` |
| 用波形表示的 GPIO 边沿和中断线 | `--vcd gpio.vcd`（用 GTKWave 或 PulseView 打开） |
| 某个 PWM 引脚的频率和占空比 | `--pwm 4` |
| 某个 ADC 焊盘最后一次 12 位采样 | `--adc 1` |
| 运行结束时的内存 | `--peek 0x3fc90000,64` |
| 哪些函数运行过、各花了多久 | `--profile-blocks`（需要 `--elf`） |
| 对某个函数的每次调用及其参数 | `--trace-fn my_function` |
| 某个寄存器块被要求做什么 | `--debug spi,i2c,wifi`（设备名或前缀） |
| 模型缺失的寄存器第一次被访问 | `--log-periph` |

运行后的报告会列出停止原因、每个核心的指令数、异常和各来源的中断。开发板自己也有单独一行：LED、显示帧、音频帧。`--no-dump` 省略寄存器转储。

## 操控它：脚本、WiFi 与浏览器里的开发板

**脚本**按模拟时间对开发板执行动作，一行一个，因此测试可复现：

```
1.5  press btn1 150          # a button for 150 ms (or a GPIO number)
2.0  gpio 17 0
3.0  touch 450 240 1         # touch panel press at (450, 240); `touch x y 0` releases
4.0  serial hello            # into the USB-Serial/JTAG console
4.2  uart0 root              # a line into UART0
6.0  stop
```

```sh
./esp32sim ... --script actions.txt --max-seconds 8
```

**WiFi**：`--wifi ssid=home,psk=secret` 挂上一个虚拟接入点，未经修改的 Espressif WiFi 库可以加入它（扫描、WPA2、DHCP、DNS、NTP）。`--net nat`（默认）让固件通过宿主机的 socket 访问真实网络，包括 HTTPS；不需要 root，也不需要 tun 设备。见 [networking-howto.md](../networking-howto.md)。

**在浏览器里看开发板**：`--web 8766` 以实时速度运行，并在 `http://127.0.0.1:8766/` 提供开发板页面。页面里有显示、按键、旋钮和触摸、可用键盘输入的控制台，以及音频。其他行为不变。

## 跑不通的时候

- **`没找到 esp32s3 的 mask ROM ELF(请传 --rom,或改用 --boot app)`**：回到第 2 步。传 `--rom`，或设置 `ESP32SIM_ROM_DIR`。
- **`不是 ESP 镜像(缺少 magic 0xE9)`**：某个参数拿到了错误的文件。`--bootloader`、`--ptable` 和 `--app` 收那三个 `.bin` 镜像；整个 flash 转储用 `--flash-image`。
- **控制台在引导程序之后就停了，或者应用立刻重启**：模块容量不对。把 `--flash-mb` 和 `--psram-mb` 设成固件构建时的目标值。`--console both` 还会显示 USB-Serial/JTAG 控制台；设置了 `CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG` 时，IDF 就打印在这里。
- **出现 `rst:0x7 (TG0WDT_SYS_RST)` 的重启循环，或者 panic**：这是固件在这个模型上的真实行为，最常见的原因是模拟器还没有的外设。`--log-periph` 会指出模型缺失的每个块第一次被访问的寄存器；`--debug <block>` 显示已实现的块被要求做什么。[peripherals.md](../peripherals.md) 列出了每款芯片有哪些外设。
- **某个函数一定不能运行**（缺失设备的驱动、校准之类）：`--stub name=0` 在函数入口直接返回该值。按名字匹配需要 `--elf`。
- **结果看起来不对**：用 `--no-jit` 再跑一次。解释器和本地代码必须在每条指令上一致；不一致就是模拟器的 bug，值得开一个 issue 并附上固件。
- **其他情况**：`--trace-fn`、`--break PC`、`--watch ADDR` 和 `--trace` 都在[调试参数表](../cli.md#debugging)里。

问题与提问：<https://github.com/mikroverk/esp32sim/issues>。报告里附上固件镜像和命令行最有用。模拟器不会向任何地方上报数据。
