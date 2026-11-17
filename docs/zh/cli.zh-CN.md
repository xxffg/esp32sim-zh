> 本文是 esp32sim v0.4.0 官方文档的中文翻译，以[上游原文](https://github.com/mikroverk/esp32sim/blob/main/docs/cli.md)为准。

# 命令行

```
esp32sim [--chip esp32|s3|c3|c6|p4|s31] --boot rom --bootloader B.bin --ptable P.bin --app A.bin [--elf X.elf ...] [options]
esp32sim --flash-image flash.bin --boot rom ...
```

所有芯片共用一个二进制。`esp32sim-c3` 就是 `esp32sim --chip c3`，`esp32sim-c6` 是 `esp32sim --chip c6`，`esp32sim-p4` 是 `esp32sim --chip p4`，`esp32sim-s31` 是 `esp32sim --chip s31`。

RISC-V 芯片的默认值随芯片而异（`--boot rom`、`--console uart0`、`--flash-mb 4`）。它们也会拒绝芯片背后并不存在的参数。

C3 不支持开发板、摄像头、PSRAM 和寄存器预设，传了会报错。C6 有开发板和 WiFi，只拒绝摄像头、PSRAM 和寄存器预设。P4 默认同样从 ROM 在 UART0 启动，闪存（flash）为 16 MB（[esp32p4.md](../esp32p4.md)）。

## 镜像与启动
| 参数 | 含义 |
| --- | --- |
| `--boot rom\|app` | `rom`：从芯片自带 ROM 的复位向量开始，走真实启动链。`app`：加载应用镜像的各段，再跳到它的入口 |
| `--bootloader F`, `--ptable F`, `--app F` | 分别写入 flash 的 0x0 / 0x8000 / 0x10000 |
| `--flash-image F` | 整个 flash 转储，写入偏移 0 |
| `--chip esp32\|s3\|c3\|c6\|p4\|s31` | 选择芯片，默认 s3；`esp32` 指经典 ESP32 |
| `--rom F` | 芯片自带 ROM 的 ELF。默认先在 `ESP32SIM_ROM_DIR` 里找该芯片的，再到 `~/.espressif/tools/esp-rom-elfs/*/` 找 |
| `--mac xx:xx:xx:xx:xx:xx` | efuse 上报的站点 MAC |
| `--cam-stream PATH\|-`, `--cam-size WIDTHxHEIGHT` | 实时 RGB24 摄像头源及其尺寸，需要 `waveshare-cam` |
| `--serial TEXT` | 运行前写入 USB-Serial/JTAG 控制台的字节 |
| `--elf F`（可重复） | 给日志和性能采样（profile）用的符号，包括应用固件 ELF 和引导程序（bootloader）ELF |
| `--flash-mb N`, `--psram-mb N` | flash 容量（JEDEC 随之变化）和 PSRAM 容量。S3 默认 8 / 2，StopWatch 为 16 / 8；octal MR2 的密度跟随 4、8、16、32 和 64 MiB。经典 ESP32 默认 4 / 0；`--psram-mb 4` 启用 quad PSRAM，`0` 关闭，其他容量会被拒绝。S31 默认 2 MiB，加 `--board mosaico` 时 16 MiB，该开发板还有 16 MiB 封装内 PSRAM；可取 1、2、4、8 或 16 |
| `--flash-octal` | octal SPI flash（ESP32-S3-WROOM-2）：Macronix octal 命令、JEDEC C2 80 xx、efuse FLASH_TYPE 为 octal，仅 S3 支持。之后会加载 `--efuse-regs` 转储：含 RD_REPEAT_DATA3（efuse +0x3c）的转储会替换该字，FLASH_TYPE（bit 9）也随之替换 |
| `--sd IMAGE`, `--sd-rw IMAGE` | （P4）参考开发板插槽中的 SD 卡（CLK 43、CMD 44、D0-D3 39-42），内容为该镜像。卡容量等于镜像大小，向下取整到 512 KiB。`--sd` 采用写时复制：固件写的数据只留在内存里，原文件不会被改动；`--sd-rw` 会把写入落到文件。见 [esp32p4.md](../esp32p4.md) 的 "SD card" 一节 |
| `--sd-prg-us N`, `--sd-serial HEX` | （P4）一次写入或擦除之后卡所需的编程时间，单位是模拟时间微秒，默认 0（瞬时）。`--sd-serial` 是卡的 CID 序列号，默认由镜像大小派生 |
| `--sd-timing` | （P4）命令和数据在 SD 总线上按插槽卡时钟和位宽真实耗时：CMD_DONE、DATA_OVER 和自动停止都要等比特传完（默认立即）。配合 `--coproc` 时，SDIO 链路也一样。见 [esp32p4.md](../esp32p4.md) 的 "The host" 一节 |
| `--usb-host F` | （P4、S31）高速 USB-OTG 端口上的一个 USB 主机，从开机起执行 F 中的命令（见下文）。随后运行继续走到 `--max-seconds`。见 [esp32p4.md](../esp32p4.md) 的 "USB" 一节 |
| `--coproc c6:KEY=VALUE,...` | （P4）SDIO 插槽 1 上的一个 ESP32-C6 协处理器，与 P4 锁步运行（见下文）。`--wifi` 和 `--net` 随后接到 C6 的射频上 |
| `--board atech14\|waveshare-cam\|waveshare-lcd4b\|waveshare-amoled18-v2\|stopwatch\|none` | 开发板模型，默认 `atech14`。在 C6 上：`waveshare-c6-lcd147`、`xiao-esp32c6` 或 `none`；在 P4 上：`waveshare-p4-lcd35`（rev ≥ 3）或 `none`。在 S31 上：`mosaico`（别名 `esp-mosaico`）或 `none`；在经典 ESP32 上：`ttgo-tdisplay`（别名 `tdisplay`）、`cyd`（别名 `esp32-2432s028`）、`ulanzi-tc001`（别名 `tc001`）、`ai-thinker-cam`（别名 `esp32cam`）、`esp32dev-loopback` 或 `none`/`esp32dev` |
| `--strap HEX`, `--reset-cause HEX`, `--efuse-regs F`, `--regs-init F` | 复现真实芯片的启动状态，供差分测试使用 |
| `--no-reboot` | 在第一次芯片复位时停止，而不是从 ROM 重新启动 |
| `--flash-at OFFSET=FILE`（可重复） | 把一个文件写入 flash 的十六进制偏移处，例如 data 分区的内容：面板的 `demo` 分区接收 `energydata.json` |
| `--stub SYMBOL[=value]`（可重复） | 执行到达函数入口时立即返回 `value`（默认 0）。以数字表示的函数地址需要 `0x` 前缀；值接受十进制、`0x` 十六进制、`true`（1）或 `false`（0）。非法值会被拒绝 |
| `--ble full` | 实验性的 C3 寄存器级 BLE 控制器：广播、扫描和一个虚拟 central。与 `--ble` 互斥 |
| `--ble-scan` | 在 C3 full 模式下启用虚拟主动扫描器：它发送 SCAN_REQ，并观察客户机配置的 SCAN_RSP |
| `--ble-observe` | 被动 full 模式的 PDU 日志：半微秒时间戳、信道、类型、AdvA、解码后的 AD 和原始 PDU |
| `--ble` | 在 S3/C3/C6 上可选启用的虚拟 BLE 控制器，需要对应的应用固件 `--elf` |
| `--ble-nearby SPEC`（可重复） | 站点周围的一个 Bluetooth LE 设备：能听到，但不可连接。客户机扫描时会在虚拟对端旁边报告它（ADV_SCAN_IND，主动扫描时还有 SCAN_RSP）。例如 `name=Thermo,rssi=-60`。`name` 为 1 到 26 字节，放在 Flags 之后的 Complete Local Name 里；`adv` 和 `rsp` 是十六进制广播数据和扫描响应，各最多 31 字节，可用 `adv` 代替 `name`。`addr` 为 aa:bb:cc:dd:ee:ff，默认是由数据派生的随机静态地址，不会以保留高两位 10 开头。`type` 为 random（默认）或 public。`rssi` 为 -127 到 20 dBm，或用 127 表示不可用，默认 -60。`name` 里不能有 `,`，这种名字请用 `adv`。最多 32 个，各占自己的地址，需要 `--ble` |
| `--wifi SPEC`（可重复） | 挂上一个 WiFi blob 能听到的虚拟接入点，外加一个虚拟网络（DHCP/ARP/ICMP/DNS/SNTP；站点 10.0.2.15，网关 10.0.2.2）。例如 `ssid=demo,chan=6,psk=demo-password,bssid=02:00:00:00:00:01`；`password` 和 `pass` 是 `psk` 的别名，未知键和非法值会被拒绝。开放网络和 WPA2-PSK 网络都能端到端加入，支持 S3、C3、C6 和经典 ESP32（docs/wifi-plan.md、docs/esp32c3.md、docs/wifi-c6-plan.md）。`--hostfwd` 把客户机的一个 TCP 端口发布到宿主机。给出多次时，每个 spec 就多一个可加入的接入点（最多 8 个）。每个接入点都发 beacon 并响应 probe，所以扫描会列出全部。站点一次只加入一个：与另一个关联，就会离开前一个。例如 `--wifi ssid=guest --wifi ssid=home,psk=home-pass`。没有 `bssid` 时，第一个保持 02:53:49:4d:00:01，后续的根据各自的 SSID 派生一个本地管理 BSSID；两个接入点既不能共用 SSID，也不能共用 BSSID。它们都挡在同一个虚拟网络前面，网络的时钟取第一个 spec 的 `epoch`（或 `--net` 的）；后面的 spec 里出现 `epoch=` 是错误 |
| `--wifi-sta SPEC` | 一个虚拟站点，加入客户机自己的接入点（客户机处于 `WIFI_MODE_AP`）：`ssid=NAME[,psk=PASSPHRASE][,mac=xx:xx:xx:xx:xx:xx]`（`password` 和 `pass` 是 `psk` 的别名，8 到 63 个字符；`mac` 默认 02:53:54:41:00:01）。它跟随客户机为该 SSID 发出的 beacon，完成认证（开放系统）和关联。给定口令时，它以 supplicant 的身份完成 WPA2 四次握手，然后从客户机的 DHCP 服务器取得租约，并为它回应 ARP。开启以太网中继（`set_ethernet_relay`）时，由宿主机上的程序充当该主机，发送并使用该站点的 MAC。运行结束行的 `[emu] wifi-sta:` 给出它的状态、加入次数、租约和帧计数；`--debug wifi-frames` 会记录每一步。它不会去碰自己加不进去的网络，并在该行说明原因：WEP 和 WPA、仅 WPA3-SAE，以及要求保护管理帧。它采用接入点的组加密（CCMP 或 TKIP），并要求成对密钥为 CCMP。遇到这些情况后，它会重新监听：被拒绝、被去认证或去关联（针对它或全部站点），或者 3 秒收不到 beacon。beacon 时间戳比上一个还旧时也一样。连续三次因相同的认证或关联状态被拒绝后，它停止，直到客户机重启。口令错误不算拒绝。握手的第 3 条消息永远不会来，站点在 1 秒后放弃，再隔 1 秒重试，于是整个运行期间大约每 2 秒一次。结束行里会带 "wrong passphrase?"。`--wifi-sta` 只能给一次，并与 `--net` 一起被拒绝，因为后者配置的是 `--wifi` 的网络。开启以太网中继时，有些帧由宿主机程序中继，站点取走后却已离开接入点，无法承载。这些帧会计入结束行。目前仅支持经典 ESP32，以及开放和 WPA2-PSK 网络。CLI 会拒绝它和 `--wifi` 并用：虚拟接入点和虚拟站点同时存在的情况没有建模。`--pcap` 会捕获站点与客户机接入点之间交换的以太网帧（docs/wifi-plan.md） |
| `--wifi-nearby SPEC`（可重复） | 站点周围的一个网络：能听到，但无法加入。扫描会连同信道、信号和安全方式一起列出，加入则像超出范围一样失败。例如 `ssid=Home,chan=1,rssi=-60,secure=1`：`chan` 为 1 到 14，默认 1；`rssi` 单位 dBm，默认 -60；`secure` 为 0 或 1，默认 1；`bssid` 可选，否则由 SSID 派生。最多 32 个，各占一个 BSSID，需要 `--wifi`。SSID 或 BSSID 与某个接入点相同的会被排除，并打印一行日志 |
| `--net nat\|none[,epoch=S]` | 虚拟网络如何处理不是自己在应答的流量。`nat`（默认，`user` 是别名）通过普通 socket 把 TCP 和 UDP 转发到宿主机自己的网络，`none` 则拒绝。`epoch=S` 设置上电时网络的时钟（自 1970 年起的秒数，最大 4294967295）。它的 SNTP 应答就是这个值加上模拟时间，于是询问时间的运行可复现。不设置时，由第一个应答时刻的宿主机时钟确定；`--wifi` spec 里的 `epoch=` 作用相同 |
| `--hostfwd tcp:HOST:HOSTPORT-GUEST:GUESTPORT` | （可重复）在宿主机上监听，并把接受的 TCP 连接作为 SYN 投递给站点。HOST 为空则绑定 127.0.0.1，GUEST 为空则为 10.0.2.15。示例：`tcp:127.0.0.1:8080-:80`。需要 `--wifi` 和 `--net nat`，不转发 UDP |
| `--pcap FILE` | 把站点收发的每个以太网帧写进经典 pcap，虚拟网络、NAT 和宿主机中继看到的都算，双向都写。linktype 1（Ethernet），微秒时间戳取自模拟时间，逐帧刷新，所以运行中就能读（`tcpdump -r`、Wireshark、dpkt-js）。一次捕获该站点的流量，不管有多少个 `--wifi` 接入点；所有带 `--wifi` 的芯片都适用，也包括 P4 运行中的协处理器 C6。配合 `--wifi-sta` 时，保存客户机接入点与虚拟站点之间的交换内容。客户机发出的帧末尾那 4 字节 802.11 FCS 位置会略去，所以两个方向保存的都是线上的以太网帧。需要 `--wifi` 或 `--wifi-sta` |
| `--trace-fn PREFIX`（可重复） | 记录对名字以 PREFIX 开头的函数的每次调用，含参数和调用者；在后面加 `$` 表示精确名字 |
| `--regstat FILE` | 退出时写入每个寄存器的访问统计（次数、pc、符号），用于逆向工程 |

## 运行
| 参数 | 含义 |
| --- | --- |
| `--version`, `-V` | 打印 `esp32sim <version>` 并退出 |
| `--help`, `-h` | 打印用法行并退出 |
| `--imu-motion N` | 脚本化的 IMU 运动：0 静止，1 在客户机时间上运行共享的 30 秒倾斜、翻转和摇晃脚本。仅限模型带 IMU 的开发板：`waveshare-amoled18-v2`（QMI8658，S3）和 `mosaico`（BMI270，S31，两颗 BMM150 磁力计随之转动） |
| `--max-seconds S` | 跑这么多模拟时间后停止，包括所有重启；`--cooja` 也适用 |
| `--max-insns N` | 限制所有重启期间的调度器工作量（详见下文）。不能与 `--cooja` 一起用，后者使用 `--max-seconds` |
| `--i2s-tone PORT:HZ:AMPLITUDE` | I2S 控制器 0 或 1 上的连续 RX 正弦波，幅度 0..1，例如 `0:1000:0.5`；多个控制器可重复 |
| `--mic-wav [PORT:]FILE` | 把宿主机 WAV 文件当作麦克风，接到 I2S 控制器 PORT（默认 0）上。要求 16 位整数 PCM，单声道或立体声（单声道会进两个 slot），采样率 1 到 192 kHz 任意。重采样按固件的 RX 速率做零阶保持（无滤波）。其他格式会被拒绝。从接收端取走第一帧起播放一次，之后静音；多个控制器可重复 |
| `--script F` | 在模拟时间上执行宿主机动作（见下文） |
| `--console usb\|uart0\|both\|all\|none`, `--console-prefix` | 打印哪些控制台 |
| `--realtime` | 不带 UI 时按墙钟节奏运行 |
| `--web PORT [--web-dir DIR]` | 浏览器 UI（隐含实时）。带 `--wifi` 时页面会得到 Network 面板：站点的以太网帧实时显示，含时间、↑ 发送 / ↓ 接收，以及来自 [dpkt-js](https://www.npmjs.com/package/dpkt-js) 0.1.0 的解析摘要。该库内置在 `web/vendor/dpkt-js` 下，在首次打开面板或点某行时加载，在此之前只显示长度和十六进制。面板还提供过滤器、暂停、清空、点帧看解析树，以及下载页面已收到帧的 pcap。帧以二进制 WebSocket 消息 `[5][dir: 0 发送 / 1 接收][模拟 µs, u64 LE][frame]` 到达，页面连上才有。两次推送之间最多积压 512 帧或 1 MiB，其余丢弃 |
| `--cam-image F`, `--cam-fps N` | 带摄像头的开发板的图像源 |
| `--cooja`（C6） | 作为 Cooja-NG 外部 mote 运行：在 stdin/stdout 上用锁步 NDJSON 协议，客户机控制台作为 `log` 事件，802.15.4 帧作为 `tx`/`rx`。遵循 `--no-reboot` 和 `--max-seconds`（见 [esp32c6.md](../esp32c6.md) 的 "Cooja-NG lock-step" 一节） |
| `--cooja-slice-us N` | 忙碌的客户机跑多久之后，才请 csim 再步进一次（默认 100；`hello.args.slice_us` 会覆盖）。一次传输要在它开始的那个 slice 结束时才到达 csim 的介质，所以这个值限定了它最多迟到多久 |
| `--cooja-rx-timing start\|end` | `t` 时刻的 `rx` 指什么：帧的起点（默认），还是它的结束（`t` 时已完整）。取起点时，csim 在帧一开始就把它交给消耗帧的 mote。`t` 是第一个前导字节，SFD 在五个字节之后，RX_DONE 在整个 PPDU 之后，ACK 再晚 192 µs |
| `--cooja-verbose` | 在 stderr 上叙述这次交换 |

历史名称 `--max-insns` 计数的是调度器工作量，而不是总退休指令数。默认调度器对核心 0 的每条指令或推进的空闲周期计一个单位，另一个核心不计入这个数。它在调度轮之间检查上限，因此可能超出请求值跑完当前轮。

使用近似代价模型时，它计数的是被调度的事件。需要可预测的时长请用 `--max-seconds`。最终执行报告会单独列出每个核心的实际指令数。

## 输出
| 参数 | 含义 |
| --- | --- |
| `--wav F` | 从 I2S 捕获的音频：哪个控制器播放的，就来自哪个 |
| `--tft-png F`, `--gram-png F` | 显示帧（可见部分，已缩放）和原始 GRAM |
| `--no-dump` | 退出时跳过寄存器转储 |
| `--adc PIN` | （可重复）该 GPIO 上最后一次完成的 ADC 转换：12 位原始计数和代号 |
| `--adc-raw PIN=COUNT` | （可重复）第一条指令之前，该焊盘上的衰减后 12 位计数（0..4095） |

### PWM 观测

`--pwm PIN` 在运行停止时报告 GPIO 矩阵 PWM 的频率（Hz）和占空比百分比。可重复以观测多个引脚。PIN 是无符号 8 位十进制数。

S3、C3、C6 和经典 ESP32 支持 LEDC；S3 和 C6 支持 MCPWM。

占空比为 0% 或 100% 的运行中定时器仍有快照。「No supported running PWM」表示该配置未布线、被禁用、已暂停或不受支持，并不意味着 GPIO 电平为低。暂停的硬件定时器可能保持最后的电平。

这里报告的是由寄存器推导出的稳态，不是采样到的边沿。不支持 LEDC 渐变，也不支持 MCPWM 的死区、载波和额外生成器动作。

### ADC 观测

`--adc PIN` 在运行停止时报告该焊盘上最后一次完成的转换。它给出 12 位原始计数和代号：固件采样前为零，之后每完成一次转换加一。

可重复以观测多个焊盘。PIN 是无符号 8 位十进制数。

`--adc-raw PIN=COUNT` 在第一条指令之前把一个衰减后计数放到焊盘上；不支持的引脚和大于 4095 的计数会被拒绝。电压脚本（`adc`、`adcwave`）仍会设置传输曲线的输入，同一引脚上的脚本会在其时间戳处替换原始计数。

焊盘、单位和电压曲线见 [peripherals.md](../peripherals.md#host-adc-inputs)。「no ADC pad」表示该 GPIO 在这颗芯片上不是 ADC 输入。

## 调试
| 参数 | 含义 |
| --- | --- |
| `--trace`, `--trace-from N` | 逐指令跟踪，从第 N 条指令开始 |
| `--break PC`（可重复） | 在 PC 处停止 |
| `--watch ADDR` | 某个字发生变化时停止 |
| `--peek ADDR,N`, `--disasm ADDR,N` | 退出时转储内存 / 反汇编 |
| `--profile` | 按指令数排序的顶部 PC：单步执行，并让空闲核心继续步进，于是空闲核心会显示为热点 `waiti` |
| `--profile-blocks` | 由块路径统计每个函数的耗时，全速运行，时序不变；按名字显示需要 `--elf` |
| `--coverage`, `--coverage-file F` | 到达的块起始地址，按函数统计；给定文件时，每行一条 `addr symbol` |
| `--irq-latency` | 从一条中断线出现在某核心，到该核心接受它之间的周期数，按线统计；保留块执行 |
| `--vcd F` | 把 GPIO 边沿和中断线写成 VCD 波形（1 ps 单位）；保留块执行 |
| `--debug AREAS` | 模型打印什么：设备名或前缀（`spi`、`usb`、`i2c`、`wifi`、`gdma`、`sha`、`rsa`、`lcd_cam`、`sdmmc`、`usb_otg` 用于 P4 的 USB-OTG 核心和主机链路；`usb` 也接受 USB-Serial/JTAG），以及 `net`、`wifi-frames`、`aes`、`rom`、`mmio`、`rt`。也可用 `ESP_EMU_DEBUG=a,b` |
| `--log-periph` | 记录对每个未知外设寄存器的首次访问 |
| `--no-jit` | 用解释器而不是本地代码执行块（aarch64 宿主机默认把块编译成机器码）。两者必须产生相同结果，所以出现可疑现象时它就是判定基准 |
| `--stop-after-exceptions N` | 在 N 次异常之后停止 |
| `--regtrace F`, `--regtrace-from-pc PC`, `--regtrace-max N` | 供 `hw/compare.py` 使用的寄存器跟踪文件 |

环境变量：`ESP_EMU_DEBUG=wifi,spi,net` 相当于给每次运行都加上 `--debug`。更早的 `ESP_EMU_DEBUG_SPI`、`ESP_EMU_DEBUG_NET`、`ESP_EMU_LOG_ALL`、`ESP_EMU_RT_LOG` 等仍可作为别名使用。`XTENSA_DIS_FILES=a.dis:b.dis` 供解码器等价性测试使用。

## 动作脚本

每行一个动作，格式为 `<seconds> <cmd> [args]`；按键和编码器为低电平有效。

```
1.5  press btn1 150        # press for 150 ms (btn1, btn2, knob/sw, or a GPIO number)
2.0  release 16
2.5  gpio 17 0
3.0  knob cw 3             # 3 detents clockwise (ccw for the other way)
4.0  serial {"action":"set_note","value":"5"}
4.2  uart0 root              # a line into UART0's receive FIFO (also `uart1`): a login on a Linux console
4.5  touch 450 30 1        # touch panel press at (450,30); `touch x y 0` releases
5.5  stop
```

`hw/wsdrive.py [port] [seconds]` 通过 UI 的 WebSocket 驱动同样的输入，并报告实时跟得上情况（推送间隔、延迟、已投递的音频）。`hw/wsaudio.py [port] [seconds]` 监听 UI 的音频流，报告采样计数和峰值，是不靠耳朵检查声音的办法。

### ADC 输入

脚本接受 `adc <gpio> <volts>` 表示恒定电压，`adcwave <gpio> <file> <rate_hz>` 表示以空白或逗号分隔的电压采样。波形从该动作的模拟时间开始。后一个输入会替换前一个来源。

S3 的 GPIO1–10 选择 ADC1，GPIO11–20 选择 ADC2；C3 的 GPIO0–4 选择 ADC1，GPIO5 选择 ADC2；C6 的 GPIO0–6 选择 ADC1。

```
0 adc 1 0.5
0 waituart0 10 ADC READY
0 uart0 A
1 adc 1 1.0
1 uart0 C
2 adcwave 1 /tmp/adc-volts.txt 1000
```

`waituart0 <timeout_s> <text>` 会暂缓后续动作，直到 UART0 打印出该文本或超时。原始计数和已完成转换的观测通过[宿主机 ADC API](../peripherals.md#host-adc-inputs)暴露。`--adc PIN` 在退出时打印最后一个完成的采样，`--adc-raw PIN=COUNT` 在运行前注入一个 12 位计数。

## USB host（P4）

`--usb-host FILE` 把一个主机插入 P4 的高速 USB-OTG 端口，并按顺序执行 FILE 中的命令，一行一条（`#` 开始注释）。每条命令在固件运行的同时，占用它在总线上所需的模拟时间。它还受本次运行的 `--max-insns`、`--max-seconds` 和重启策略约束（`--no-reboot`、app 模式下的 Restart）。

第一条失败的命令会结束该文件，除非它的行以 `?` 开头：那样失败会被记录，文件继续往下走。若某次失败导致端口上不再有设备，则断开接口和卷，如同 Linux 的断连。随后运行继续走到它的时间上限。

每条命令做了什么会以 `[usb-host] t=<seconds> ...` 写到 stderr，运行结束报告会追加一行 `[usb]`，含核心和主机的计数。时间最大一天（86400000 ms），块数最大 65536，文件最大 1 GiB；更大的值是用法错误。

| 命令 | 主机做什么 |
| --- | --- |
| `attach [timeout_ms]` | VBUS 打开，等待设备连接（10 s），去抖 100 ms，端口复位，GET_DESCRIPTOR，SET_ADDRESS，读取配置和字符串，SET_CONFIGURATION |
| `detach`, `reset` | VBUS 关闭；复位并重新枚举 |
| `port-reset` | Linux 的 `usb_reset_device`：复位、GET_DESCRIPTOR（64）、复位、SET_ADDRESS 到同一地址、读取并比较描述符、再次 SET_CONFIGURATION |
| `suspend`, `resume`, `idle MS` | 停止 SOF；驱动 resume 20 ms；让时间流逝 |
| `rate MBPS` | 限制主机每个微帧的 bulk 载荷，用来模拟更慢的主机 |
| `msc` | 打开 bulk-only 大容量存储接口：GET MAX LUN、INQUIRY |
| `recovery linux`, `recovery bot` | 传输错误或命令超时之后如何恢复。默认按 Linux v6.12 usb-storage 做端口复位，只有它失败时才做 class 复位；`bot` 则用 BOT 1.0 的复位恢复 |
| `timeout MS` | 一条命令在被主机中止之前可以花多久（30000，即 sd 的 SD_TIMEOUT） |
| `inject vbus-off MS` | 从现在起 MS 之后 VBUS 断开，不管主机当时在做什么；进行中的传输以断连结束 |
| `ready INTERVAL_MS TIMEOUT_MS` | 反复 TEST UNIT READY 直到通过，每次失败后 REQUEST SENSE |
| `poll INTERVAL_MS MS` | 在一段时间内每隔一个间隔做 TEST UNIT READY，就像主机轮询可移动磁盘。这里或 `ready` 看到 NOT READY 会卸载已挂载的卷 |
| `capacity`, `mode-sense`, `prevent`, `allow`, `sync`, `eject` | READ CAPACITY(10)、MODE SENSE(6)、PREVENT ALLOW MEDIUM REMOVAL、SYNCHRONIZE CACHE(10)（被拒绝只记录，不算错误）、带 LoEj 的 START STOP UNIT |
| `read LBA COUNT`, `write LBA COUNT BYTE`, `verify LBA COUNT BYTE` | READ(10)（及其哈希）、写入单个字节值（十六进制）的 WRITE(10)、READ(10) 并比较 |
| `mount`, `ls` | 挂载 LUN 上的 FAT32 卷（MBR 的分区，或从 LBA 0 开始），然后列出它的根目录 |
| `fat-write NAME BYTES CHUNK_KIB [GAP_MS] [FAT_EVERY]` | 以类 vfat 的顺序写入一个 8.3 名字的测试文件：先写目录项，再分块写数据，每 FAT_EVERY 块（默认 1）之后写两份 FAT 扇区。接着写目录项的大小和簇，以及 FSInfo。第 i 块应在开始后 GAP_MS·i 时到达，如同固定速率的源产出它们。日志给出总体速率、后半段速率，以及相对该计划的最差迟到。它还会说明主机是否跟得上（从未落后整整一个块） |
| `fat-read NAME` | 读回一个文件；本文件写过的，会与写入内容比较 |
| `uart0 TEXT` | 向固件的 UART0（它的控制台）写入一行 |
| `cdc MS [TEXT]` | 打开 CDC-ACM 接口（SET_LINE_CODING、DTR+RTS）。给定 TEXT 时，在其 bulk OUT 端点上发送 TEXT 加 CR LF，并在 MS 毫秒内把设备发送的内容复制到 stdout |

`examples/usb_msc-p4/host.txt` 写入一个文件、弹出驱动器、在示例应用拥有该卡期间轮询它（MEDIUM NOT PRESENT），然后重新接管。`examples/usb_msc-p4/faults.txt` 会遇到故障：传输中途超时的命令、弹出后的端口复位，以及写文件过程中丢失 VBUS。

## 协处理器（P4）

`--coproc c6:KEY=VALUE,...` 把一个 ESP32-C6 放到 P4 的 SDIO 插槽 1 上，接线按 ESP-Hosted 在参考开发板上的方式（CLK 18、CMD 19、D0-D3 14-17、C6 的 EN 接 GPIO 54）。两颗芯片在同一时钟上锁步运行（[esp32p4.md](../esp32p4.md) 的 "The co-processor"）。

C6 上电时从自己的芯片自带 ROM 启动；`--wifi` 把虚拟接入点接到它的射频上，`--net` 接它背后的网络。仅原生构建可用：浏览器构建没有协处理器。

```sh
esp32sim-p4 --flash-mb 2 --bootloader p4-bootloader.bin --ptable p4-ptable.bin --app wifi_station.bin \
    --coproc c6:bootloader=c6-bootloader.bin,ptable=c6-ptable.bin,app=network_adapter.bin,otadata=ota_data_initial.bin,stub=bb_init=0,elf=network_adapter.elf \
    --wifi ssid=esp32sim,psk=esp32sim-pass --max-seconds 6
```

| 键 | 含义 |
| --- | --- |
| `bootloader=F`, `ptable=F`, `app=F` | C6 的镜像，位于 0x0、0x8000 和 0x10000（`app` 必需） |
| `otadata=F[@OFFSET]` | OTA data 分区的镜像，默认在 0xD000，除非后面跟了偏移（十六进制） |
| `elf=F`（可重复）, `stub=SYMBOL[=value]`（可重复） | C6 的符号和函数桩，等同于 C6 运行时的 `--elf` 和 `--stub`（C6 射频运行需要 `stub=bb_init=0`） |
| `rom=F` | C6 的芯片自带 ROM 的 ELF，默认 `esp32c6_rev0_rom.elf`，查找方式同 `--rom` |
| `flash-mb=N`, `mac=xx:..` | C6 的 flash 容量（4）和 efuse MAC（40:4c:ca:00:11:22） |
| `en=N`, `en=!N` | C6 的 EN 跟随的 P4 GPIO（54）：拉低使 C6 保持复位，拉高或不驱动（上拉）则让它运行；`!` 表示反相 |
| `slice-us=N` | 锁步 slice（10）：slave 的 SDIO 中断最晚多久到达 P4 |
| `console=F` | 把 C6 的控制台写入 F，而不是 stdout |
| `fault=KIND@WHEN`（可重复） | 在运行确定的时点向 SDIO 链路注入故障。`read-crc@N[:K]`、`read-timeout@N`：第 N 次 FIFO 读在 slave 给出数据后失败，或在包含字节 K 的块处失败；`reg-read-crc@N` 是第 N 次寄存器窗口读。`write-crc@N`、`write-nostatus@N` 是第 N 次 FIFO 写；`cmd-timeout@N`、`resp-crc@N` 是第 N 条命令。`wedge@T` 让 C6 的 CPU 停止，但其 SDIO 硬件仍应答；还有 `dead-bus@T`、`drop-irq@T`（一个 DAT1 边沿未被锁存）、`spurious-irq@T+D`、`token-stall@T+D`（TOKEN1 显示没有空闲缓冲）。T 和 D 写作 `3.5s`、`200ms`、`1500us`。见 [esp32p4.md](../esp32p4.md) 的 "Faults" 一节 |

两个控制台都按 slice 产生的顺序逐行输出到 stdout：P4 的原样输出（加 `--console-prefix` 时前面带 `[p4] `），C6 的 UART0 前面带 `[c6] `。运行结束报告会追加 C6 的行（`[c6] stop:`、它的 SDIO 计数、WiFi 和网络计数），以及 `[cosim]`（slice 数、EN 变化、P4 复位）。

有的话还会包括：命令发现 C6 已跑到它们前面、EN 脉冲太短没能复位它，以及每个故障及其触发时间。`--debug sdio` 打印 C6 slave 的命令和 DMA，`--debug sdmmc` 打印 P4 主机的命令。`--max-seconds` 会向上取整到整个 slice；`--max-insns` 不适用。

## 虚拟 BLE

`--ble --elf firmware.elf` 在 S3 和 C3 上替换控制器生命周期和 legacy VHCI 函数，在 C6 上替换原生 NimBLE 传输。客户机的 BLE 主机（host）协议栈和 sketch 保持不变。

模拟器创建的 FreeRTOS 任务通过客户机回调投递控制器数据包。S3 使用窗口化的 Xtensa ABI，C3 使用 RV32IMC。

S3/C3 需要未 strip 的控制器、VHCI、任务和 BSS 符号。C6 需要原生传输、NPL 和 mbuf 分配器符号；它的开发板镜像需要 `--flash-mb 8`。

C6 **仅支持 ESP-IDF 5.5.x**。启用时从应用固件 ELF 读取 `esp_app_desc.idf_ver`，并在安装钩子之前拒绝缺失、格式错误或其他版本。

它的原生传输使用该版本的 `os_mbuf` 布局和 NPL 初始化。S3/C3 接受暴露出所需 VHCI/生命周期符号、控制器 BSS 和函数大小的构建，没有 IDF 版本门槛。

启用时采用传给 init 的配置中的模式，与 IDF 一致：S3/C3 上是 BLE（1），它们的 init 不接收其他参数；经典 ESP32 上是 1、2 或 3（[esp32.md](../esp32.md)）。

已验证 Arduino 3.3.8 + IDF 5.5.4。不支持 IDF 4.4 Bluedroid，会因缺少符号而失败。其他 IDF 版本尚未验证。

VHCI 发送的包也可以位于已映射的 PSRAM 中。S3 上的例子是 StopWatch 的 ESP-IDF 6.1 构建，它用外部 NimBLE 分配；经典 ESP32 上配合 `--psram-mb 4`，用 `CONFIG_BT_ALLOCATION_FROM_SPIRAM_FIRST` 构建的 Bluedroid 也这样。

每一页都必须映射到已安装的 PSRAM，并且经典 ESP32 上缓存必须能读取它；flash、非法映射和越界包都会被拒绝。控制器任务的 trampoline 及其接收缓冲仍需要内部控制器 BSS。

`[ble]` 输出报告广播数据和发现的 GATT handle。脚本命令和其他脚本动作一样使用秒。例如：

```text
0.5 ble connect
0.6 ble discover
1.0 ble read 0x0010
1.1 ble write 0x0010 68656c6c6f
```

使用 discovery 报告出来的 handle。`ble subscribe CCC_HANDLE` 向已发现的客户端配置描述符写入通知使能。命令在解析 CLI 参数时、加载 ROM 之前校验，并且需要 `--ble`。

`connect` 等待客户机开始广播；ATT 命令等待连接，并按顺序执行，同一时刻只有一个请求在途。退出时，CLI 报告仍有排队或在途的命令数。

写入限制为 20 字节。正在扫描的客户机会看到一个名为 `esp32sim`、广播 Battery Service 的虚拟外设。

这里建模的是一条未加密的 LE 链路、legacy 广播和 ATT MTU 23。不模拟射频、配对、物理连接时序或控制器的寄存器。不支持的 HCI 命令返回 Unknown Command。

控制器报告 LL Privacy，并维护一个 10 项的解析列表，状态与 ESP32-S3 控制器一致，因此 BLE 主机协议栈可以配置控制器隐私。它不解析任何地址，也不生成可解析私有地址。

回调任务及其存储会一直分配，直到重启。C6 初始化客户机的 NPL 支持和由堆支撑的 mbuf 池；它不使用控制器 BSS 预留。代价模型执行不支持函数替换；报告的周期时间不是射频时序。

`--ble full` 选择实验性的 C3 链路层控制器寄存器模型，并排除 `--ble` 的 HCI 替换。它运行原始的客户机控制器，不使用 ELF 钩子。

它实现了初始化、时钟捕获、定时器中断，以及信道 37–39 上的 legacy 广播。完成中断让客户机能调度下一个事件。

`--ble-observe` 以 `[ble-air]` 行把发出的 ADV_IND、ADV_NONCONN_IND 或 ADV_SCAN_IND 包记录到 stderr；`hus` 是以半微秒为单位的模型时间。`[ble-config]` 单独报告配置的 SCAN_RSP 数据；被动观察者无法引出该响应。

队列保留最近 1024 条观测，轮询时报告丢弃的条目。`--ble-scan` 通过客户机的 RX 描述符启用主动 SCAN_REQ/SCAN_RSP 交换。

使用脚本命令 `ble connect`、`ble read-uuid SERVICE CHARACTERISTIC`、`ble central-stop` 和 `ble disconnect`。最后一条发送 LL_TERMINATE_IND；`central-stop` 让 central 沉默，好让客户机的监督超时能够到期。在 `central-stop` 与该超时之间发出的 `read-uuid` 会排进这条沉默链路并丢失，请在下次 `connect` 之后再发。例如，用 `--ble full --script connection.txt` 传入这个文件：

```text
0.5 ble connect
0.7 ble read-uuid 4fafc201-1fb5-459e-8fcc-c5c9c331914b beb5483e-36e1-4688-b7f5-ea07361b26a8
3.1 ble central-stop
```

该模型支持一条未加密的 1M CSA#1 链路、固定 30 ms 间隔和 2 s 监督超时、默认 ATT MTU 23，不做 L2CAP 分片。即使没有 ATT 请求，它也会回复 LL_VERSION_IND。不支持配对、CSA#2、PHY 更新和可选的 LL 过程。

寄存器含义和数据包时序仍是推断/模型选择。[EX213 证据](../evidence/ble-c3-connection/README.md)把历史上的 probe-b 现场检查与未经验证的射频时序区分开来。

## 实时摄像头输入

经典 ESP32 请用 `--chip esp32 --board ai-thinker-cam --cam-image image.bmp`（BMP 或 PPM）。这是用于 OV2640 原始 RGB565/YUV422 采集的静态源，帧率固定约 10 FPS。

基线 JPEG 文件（`--cam-image photo.jpg`）在大小等于配置的帧尺寸时，会原样交给 `PIXFORMAT_JPEG` 固件。格式错误或非基线 JPEG 是用法错误；尺寸不符则不产生帧，只留一条 `[camera] JPEG output` 提示。

不支持可调的经典款帧节奏。公开驱动夹具和完整命令见 [esp32.md](../esp32.md#the-camera---board-ai-thinker-cam)。下面关于实时流、裁剪和可调 FPS 的说明适用于 S3 的 `waveshare-cam`，不适用于经典款模型。

在 `--board waveshare-cam` 上，`--cam-stream PATH --cam-size WIDTHxHEIGHT` 读取连续的 RGB24 帧，没有文件头或行填充。用 `-` 表示 stdin，或用 FIFO 路径接收另一个进程产生的数据。

串流会启用实时节奏，只保留最新的完整输入，并在 EOF 时保留最后一张图像。被截断的帧会报错，并保持上一张图像不变。

这只是实时源：普通文件会被尽快读取，因此固件看到的帧不确定；确定性的静态输入请用 `--cam-image`。FIFO 的打开在读取线程上进行，不会阻塞模拟器启动或关闭。

输入尺寸受浏览器限制：等效的 RGBA 消息必须不超过 8 MiB，该限制同样适用于 `--cam-image`。`--console` 仍然选择固件控制台输出。

对于 macOS 网络摄像头，用 `ffmpeg -f avfoundation -list_devices true -i ''` 选择视频设备，然后把下面命令中的 `0` 换成它的索引：

```sh
ffmpeg -f avfoundation -framerate 10 -video_size 640x480 -i '0:none' \
  -an -pix_fmt rgb24 -f rawvideo - |
  target/release/esp32sim --board waveshare-cam --boot rom \
    --rom "$ROM" --bootloader "$BOOTLOADER" --ptable "$PTABLE" --app "$APP" \
    --cam-stream - --cam-size 640x480 --no-dump
```

固件通过 SCCB 配置 OV5640。模型裁剪其传感器阵列窗口，用最近邻采样缩放到输出尺寸，并按 MSB first 输出 RGB565、YUYV422 或灰度 Y8。`--cam-image` 仍可加载 BMP 或 PPM；实时帧通过同一个开发板钩子替换该图像。

没有宿主机图像时，配置的传感器提供黑帧，以便固件完成初始化。`--cam-fps` 独立于宿主机更新的节奏，控制模拟采集节奏。

不支持 JPEG 编码和 RAW Bayer，它们不产生帧。光学黑像素、ISP 偏移、binning、镜像/翻转、曝光和传感器时钟校准均未建模。

摄像头裁剪/缩放不模拟 ISP 偏移（0x3810–0x3813）、镜像/翻转（0x3820/0x3821）或 binning。典型驱动设置可能与传感器相差约 2.5%（水平）和 1.6%（垂直）；镜像/翻转不会应用。

在经典 ESP32 上，`touchpad <gpio> <0|1>` 驱动一个电容焊盘，与面板的 `touch <x> <y> <0|1>` 动作相互独立。例如 `0 touchpad 4 1` 在零时刻施加触摸。`adc` 和 `adcwave` 也支持经典款的 ADC 焊盘。

## I2S 麦克风输入

标准 I2S RX 在 S3 的控制器 0/1、C3/C6 的控制器 0 和 S31 的控制器 0/1 上支持 16/24/32 位单声道或立体声。它经由 AHB-GDMA，也包括 TX 和 RX 共用一个端口时 ESP-IDF 建立的那种全双工 slave RX（跑在 TX 时钟上）。S3 的控制器 0 还接受 16 位的 PDM-to-PCM RX。

`--i2s-tone 0:1000:0.5` 提供半满量程的连续 1 kHz 正弦波；`--mic-wav 0:speech.wav` 播放一次录音；两者都省略则静音。该音源在软件复位后仍然存在。

Rust 宿主程序用 `SocBus::i2s_input(port)` 访问 `PcmInput`。`push(&[[left, right]])` 按固件编程的采样率排队有符号 16 位立体声帧，单声道输入时把每个采样复制到两个声道。`push` 返回被接受的数量，队列上限 65536 帧，剩余的帧稍后重试。

`clear()` 清除排队数据并关闭音调。空队列读出为零。排队输入在 RX 或其 DMA 通道停止期间暂停，包括重启期间。

每个 16 位输入采样取客户机采样的高 16 位，低位为零。32 位 RX 每个采样写 4 字节。

24 位 RX 每个采样写 3 字节，即 ESP-IDF 分配的尺寸，除非固件设置了 RX_24_FILL_EN（RX_CONF bit 16），那会把每个采样补齐到 4 字节。未编程的 RX_EOF_NUM 使用硬件复位值 0x40。

输入在 PCM/DMA 边界接入控制器。它不模拟 GPIO 连线、串行位时序或 PDM 滤波响应。不支持原始 PDM、外部 slave 时钟、多于两个 slot、压扩（companding）以及反序的位/字节序。

C3/C6 和 S3 的控制器 1 没有硬件 PDM-to-PCM 转换器，所以它们的原始 PDM 模式不消费这个 PCM 源。已有的 I2S TX 捕获不变。

### 独立源时钟

Rust 宿主程序用 `SocBus::attach_pcm_sources()` 附加共享的源库，并向其 `inputs` slot 向量追加 `PcmSource` 值。每个源要么用 `PcmPins::I2s` 指定 BCLK/WS/data 引脚，要么用 `PcmPins::Pdm` 指定 clock/data 引脚，并带有 8 到 96 kHz 的速率。推送保留最新的两秒。

在每次推送或修改 slot 之前先调用 `attach_pcm_sources()`；它会同步源库的时钟（在 S3 上还会冲刷延迟的 tick）。`SocBus::pcm_sources()` 是只读的：返回最近一次同步时已附加的源库，或 None，且不做任何改动。队列在 RX/DMA 停顿时继续推进，并在复位后保留。

矩阵路由选择最低的匹配 slot；匹配到的源欠载时产生静音。路由不匹配任何 slot 的接收端保留其按控制器输入，因此附加源库后 `--i2s-tone` 和 `i2s_input` 推送仍然有效。对已路由的源调用 `tone()` 会被拒绝，请改为推送生成的帧。

路由只匹配 RX 的 BCK/WS 输出信号。在 ESP-IDF 全双工标准模式下，较晚初始化的通道成为 slave，BCK/WS 引脚通常承载 TX 输出信号（IDF v5.5.5 `esp_driver_i2s/i2s_std.c`，第 214–237 行和第 292–297 行）。

这种双工 codec 配置不匹配任何已路由的源，而是读取其按控制器输入。这里建模的是矩阵选择和 PCM 采样，不是 IO_MUX、焊盘使能、串行边沿或 PDM 滤波。

在 Rust 宿主程序里，ADC 音频通过 `analog_set` 附加 `AnalogSource::Stream(stream.clone())`。创建 `AnalogStream::new(rate, bias_volts, cycles)`，并用 `push(samples, cycles, CPU_HZ)` 推送有限的 `f32` 电压。要精确的 12 位计数，创建 `AnalogStream::new_raw(rate, bias_count, cycles)`，以 `AnalogSource::RawStream` 附加，并调用 `push_raw(samples, cycles, CPU_HZ)`。

流的速率从 1 Hz 到 96 kHz，所以缓慢的传感器流也可以。非法采样不会破坏队列和时间。在模拟器两次运行之间按总线当前的周期计数推送。

转换使用 `AnalogInputs.cpu_hz`。缓冲区保留两秒，溢出时丢弃最旧的采样，欠载时保持最后一个值。两种形式都保持 main 的已完成转换观测计数。
