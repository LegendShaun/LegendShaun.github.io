# PMD040驱动

PMD040的时序是非标准的spi时序. 没办法直接用硬件spi实现. 之前的驱动都是用GPIO口模拟时序实现的. 但由于使用IO口模拟存在CPU占用率高,且速度低且不稳定的问题. 需要使用硬件SPI实现.

## AT32F421芯片驱动

目前是在AT32F421芯片上面进行调试.

关于AT32F421的硬件SPI. 有全双工.半双工的区别. 

由于PMD040是通过SCK和Dout两线与MCU进行通信的,所以最初写驱动的时候一直认为是通过硬件SPI的半双工模式进行编写.

经过尝试后发现,如果使用半双工的接收模式进行数据接收. SCK线会不断发送时钟信号,无法进行控制.

而硬件SPI的全双工模式, 是同时进行发送和接收. 但由于MCU是主机,PMD040是从机. 在SPI通信过程中是由主机发送时钟信号的. 但SPI的主机只有在发送数据的时候才会发送时钟信号. 因此,哪怕主机只是接收数据,在接收数据的过程中,也需要发送需要的时钟长度的任意数据来产生时钟信号,再进行数据接收. 

关于硬件SPI的配置, 首先是把IO口复用为SPI模式. 

然后根据PMD040的数据手册进行相对应的配置. 

由于PMD040是在时钟上升沿将数据发送到MCU然后在下降沿的时候让MCU采样. 并且在空闲的时候时钟信号为低电平.

所以根据上述进行时钟极性和相位的配置

```c
spi_init_struct.clock_polarity = SPI_CLOCK_POLARITY_LOW;   
spi_init_struct.clock_phase = SPI_CLOCK_PHASE_2EDGE;
```

并且,由于PMD040是由SCK和Dout两线通信,没有CS线,所以需要配置SPI为软件CS. 并且根据数据手册,DOUT引脚输出数据是最显著位(MSB)在前.PMD040-S08是24位ADC. 所以只能配置位8bit.

```c
spi_init_struct.first_bit_transmission = SPI_FIRST_BIT_MSB;
spi_init_struct.frame_bit_num = SPI_FRAME_8BIT;
spi_init_struct.cs_mode_selection = SPI_CS_SOFTWARE_MODE;
```

根据读取数据的时序图

![image-20251105100335789](C:\Users\Administrator\AppData\Roaming\Typora\typora-user-images\image-20251105100335789.png)

可以看出,在读取数据的过程中需要产生27个时钟信号,但是由于硬件SPI一次性只能产生最低8个时钟信号,因此我们只能产生32个时钟信号,然后忽略到多余的信号. 并且由于24位ADC数据都是在前面24个时钟信号进行传输,在读取数据的过程,我们只需要读取前24个时钟的数据.

```c
s32 pmd040_read_data(void)
{
	u8 reg;
	u32 data;
	s32 out;
	for(int i =0;i<4;i++)
	{
		while(spi_i2s_flag_get(SPI1, SPI_I2S_TDBE_FLAG) == RESET);
		spi_i2s_data_transmit(SPI1, 0x00);
		if(i<3)
		{
			while(spi_i2s_flag_get(SPI1, SPI_I2S_RDBF_FLAG) == RESET);
			reg = spi_i2s_data_receive(SPI1);
			data |=reg;
			data<<=8;
		}
		
	}
	out = (s32)(data<<8);
	out >>=8;
	return out;
}
```



由于没有CS线,当ADC的数据准备就绪后,会从DOUT口输出低电平. DOUT除了会连接SPI的MISI口以外,同时还需要连接另一个GPIO口,作为外部终端EXINT的引脚. 配置外部中断位下降沿触发, 这样子每次在DOUT口输出低电平的时候,触发中断,然后在中断中读取ADC数据.



```c
//EXINT配置
void exint_line_init(void)
{
	exint_init_type exint_init_struct;
	crm_periph_clock_enable(CRM_GPIOA_PERIPH_CLOCK, TRUE);
	crm_periph_clock_enable(CRM_SCFG_PERIPH_CLOCK, TRUE);

	scfg_exint_line_config(SCFG_PORT_SOURCE_GPIOA, SCFG_PINS_SOURCE0);

	exint_default_para_init(&exint_init_struct);

	exint_init_struct.line_enable = TRUE;
	exint_init_struct.line_mode = EXINT_LINE_INTERRUPUT;
	exint_init_struct.line_select = EXINT_LINE_0;
	exint_init_struct.line_polarity = EXINT_TRIGGER_FALLING_EDGE;
	exint_init(&exint_init_struct);
	exint_interrupt_enable(EXINT_LINE_0, TRUE);
	nvic_priority_group_config(NVIC_PRIORITY_GROUP_4);
	nvic_irq_enable(EXINT1_0_IRQn, 2, 0);
}

//外部中断函数
void EXINT1_0_IRQHandler(void)
{
	if(exint_interrupt_flag_get(EXINT_LINE_0) != RESET)
	{
		val = pmd040_read_data();
		printf("%d\n",val);
		exint_flag_clear(EXINT_LINE_0);
		
	}
}
```



由于写ADC的寄存器和读取寄存器的时钟比较复杂,难以用硬件SPI直接模拟. 但ADC寄存器的读写只有在上电的时候会进行配置,不会重复进行配置. 因此该函数的实现还是通过IO口模拟进行实现. 当ADC配置成功后,后续的数据读取就使用硬件SPI实现, 也可以降低CPU的占用率.







---

### 更新

仅仅只通过spi的硬件读取对于速度提升不够. 因为在读取数据的时候,由于`while(spi_i2s_flag_get(SPI1, SPI_I2S_TDBE_FLAG) == RESET);`和`while(spi_i2s_flag_get(SPI1, SPI_I2S_RDBF_FLAG) == RESET);`,CPU一直等待标志位. 从而导致占用率高. 为了防止CPU一直在中断中等待标志,可以使用SPI的中断.

`main`函数的主要流程和上面方法类似,首先用GPIO口模拟SPI,将ADC的寄存器进行初始化配置. 配置完成后, 再将GPIO口重新配置,复用为SPI.并开启外部中断.

不同的是,SPI配置完成后,需要开启SPI中断. 由于我们作为主机进行接收数据,因此只需要开启SPI的接收中断即可.

```c
spi_config();
spi_i2s_interrupt_enable(SPI1, SPI_I2S_RDBF_INT, TRUE);  //RDBF receive data buffer full flag.
exint_line_init();
```

现在我们就不需要在外部中断中进行数据读取了. 每当外部中断触发,我们只需要将SPI的相关中断配置进行初始化即可. 需要注意的是, 由于这个外部中断脚和ADC芯片的数据引脚是同一个,因此我们需要防止由于数据变化导致的下降沿触发外部中断, 因此需要通过一个标志来表示判断下降沿是数据还是数据开始标志. 

```c
void EXINT1_0_IRQHandler(void)
{
	if(exint_interrupt_flag_get(EXINT_LINE_0) != RESET)
	{
		if(flag==0)
		{
			flag = 1;
			times=0;
			spi_i2s_data_transmit(SPI1,0x00);

		}
		exint_flag_clear(EXINT_LINE_0);
	}
}
```

上面的flag是一个全局变量,作为判断标志. times是由于数据需要27个时钟,因此需要4个byte的时钟.并且在最初的时候,通过调用`spi_i2s_data_transmit(SPI1,0x00);`发送第一个byte的时钟,且开始形成接收buffer标志. 

然后在接收buffer满中断函数中进行处理

```c
void SPI1_IRQHandler(void)
{
	if(spi_i2s_interrupt_flag_get(SPI1, SPI_I2S_RDBF_FLAG) != RESET)
	{
		spi1_rx_buffer[times++] = spi_i2s_data_receive(SPI1);
		if(times<4)
		{
			spi_i2s_data_transmit(SPI1,0x00);
		}
		else{
			printf("%x\n",(spi1_rx_buffer[0]<<16)|(spi1_rx_buffer[1]<<8)|spi1_rx_buffer[2]);
			flag = 0;
		}
	}
}
```

### DMA+SPI

但是这种方法需要触发四次SPI的中断才能完成一次数据接收. 因此我们可以利用硬件DMA来提高速度. 首先SPI的数据传输是可以通过DMA自动进行实现. 我们只需要在DMA的数据传输完成后,触发中断,在中断函数中将数据取出来就可以.

首先是SPI配置,在进行SPI配置的时候,需要开启SPI的DMA通道.

并且需要先开启DMA通道,再开启SPI.

```c
void spi_config(void)
{
	crm_periph_clock_enable(CRM_SPI1_PERIPH_CLOCK, TRUE);
	crm_periph_clock_enable(CRM_DMA1_PERIPH_CLOCK, TRUE);
	
	dma_reset(DMA1_CHANNEL2);
	dma_reset(DMA1_CHANNEL3);
	
	dma_default_para_init(&dma_init_struct);
	
	dma_init_struct.buffer_size = BUFFER_SIZE;
	dma_init_struct.direction = DMA_DIR_PERIPHERAL_TO_MEMORY;
	dma_init_struct.memory_base_addr = (uint32_t)spi1_rx_buffer;
	dma_init_struct.memory_data_width = DMA_MEMORY_DATA_WIDTH_BYTE;
	dma_init_struct.memory_inc_enable = TRUE;
	dma_init_struct.peripheral_base_addr = (uint32_t)&(SPI1->dt);
	dma_init_struct.peripheral_data_width = DMA_PERIPHERAL_DATA_WIDTH_BYTE;
	dma_init_struct.peripheral_inc_enable = FALSE;
	dma_init_struct.priority = DMA_PRIORITY_MEDIUM;
	dma_init_struct.loop_mode_enable = FALSE;
	dma_init(DMA1_CHANNEL2, &dma_init_struct);
	
	dma_init_struct.direction = DMA_DIR_MEMORY_TO_PERIPHERAL;
	dma_init_struct.memory_base_addr = (uint32_t)spi1_tx_buffer;
	dma_init_struct.peripheral_base_addr = (uint32_t)&(SPI1->dt);
	dma_init(DMA1_CHANNEL3, &dma_init_struct);
	
	dma_interrupt_enable(DMA1_CHANNEL2,DMA_FDT_INT,TRUE);
	
	nvic_priority_group_config(NVIC_PRIORITY_GROUP_4);
	nvic_irq_enable(DMA1_Channel3_2_IRQn,1,0);
	
	spi_default_para_init(&spi_init_struct);
	
	spi_init_struct.transmission_mode = SPI_TRANSMIT_FULL_DUPLEX;
	spi_init_struct.master_slave_mode = SPI_MODE_MASTER;
	spi_init_struct.mclk_freq_division = SPI_MCLK_DIV_256;
	spi_init_struct.first_bit_transmission = SPI_FIRST_BIT_MSB;
	spi_init_struct.frame_bit_num = SPI_FRAME_8BIT;
	spi_init_struct.clock_polarity = SPI_CLOCK_POLARITY_LOW;
	spi_init_struct.clock_phase = SPI_CLOCK_PHASE_2EDGE;
	spi_init_struct.cs_mode_selection = SPI_CS_SOFTWARE_MODE;
	spi_init(SPI1, &spi_init_struct);
	
	spi_i2s_dma_receiver_enable(SPI1, TRUE);
	spi_i2s_dma_transmitter_enable(SPI1, TRUE);
	
	spi_enable(SPI1, TRUE);
}
```

这里需要注意,DMA的循环模式应该设置为FALSE,否则会不断进行DMA传输,产生中断. 我们需要通过外部中断来开启DMA,从而控制中断产生的频率和ADC输出信号的频率一致.

```c
void EXINT1_0_IRQHandler(void)
{
	if(exint_interrupt_flag_get(EXINT_LINE_0) != RESET)
	{
		if(flag ==0)
		{
			flag = 1;
			dma_channel_enable(DMA1_CHANNEL2, FALSE);
			dma_channel_enable(DMA1_CHANNEL3, FALSE);		
			DMA1_CHANNEL3->dtcnt = BUFFER_SIZE;
			DMA1_CHANNEL2->dtcnt = BUFFER_SIZE;
			dma_channel_enable(DMA1_CHANNEL2, TRUE);
			dma_channel_enable(DMA1_CHANNEL3, TRUE);
		}
		exint_flag_clear(EXINT_LINE_0);
	}
}
```

然后在DMA中断中取数据.

```c
void DMA1_Channel3_2_IRQHandler(void)
{
	if(dma_interrupt_flag_get(DMA1_FDT2_FLAG)!= RESET)
	{
		s32 out;
		

		out = (spi1_rx_buffer[0]<<16)|(spi1_rx_buffer[1]<<8)|spi1_rx_buffer[2];
		out = (out<<8) >> 8;
		printf("%d\n",out);
		flag = 0;
		dma_flag_clear(DMA1_FDT2_FLAG);
	}
}
```

## 杰理AC620

```c
typedef struct spi_control{
    u8 flag;    //标志数据是否正在读取
    u8 times;   //每次读取数据需要发送四次1byte时钟
    u8 buf[4]; //读取数据缓存
} SPI_CTRL;

static SPI_CTRL spi_ctrl;
```

定义结构体



在IO中断中对SPI进行设置并启动

```c
if(spi_ctrl.flag)
{
    spi_ctrl.flag = 0;
    spi_ctrl.times = 0;
    SPI1_BUF = 0x00;
}
```



在SPI中断中进行判断,发送四次时钟并且读取数据

```c
SET(interrupt(""))
static void spi_isr(void)
{
    if(SPI1_CON & BIT(15))
    {
        spi_ctrl.buf[spi_ctrl.times++] = SPI1_BUF;
        if(spi_ctrl.times<4)
        {
            SPI1_BUF = 0x00;
        }
        else
        {
            spi_ctrl.flag = 1;
            kors_adc_val = (s32)(((spi_ctrl.buf[0]<<24)|(spi_ctrl.buf[1]<<16)|spi_ctrl.buf[2]<<8)>>8);
            //printf("%d\n",kors_adc_val);
            SPI1_CON |= BIT(14);
        }
    }
}
```





对于驱动初始化

```c
void cs1237_sample_init(void)
{
    spi_ctrl.flag = 1;
    spi1_drv->init(SPI1_PORTA_8_10, SPI_2WIRE_MODE, SPI_CLK_DIV256);
    SPI1_CON |= BIT(13);
    set_wkup_xxx(2, 1, 3);      //PA3,下降沿唤醒
    HWI_Install(PORT_INIT, io_int_isr, 0);
    HWI_Install(SPI1_INIT,spi_isr,0);
    IOKEY_INIT();
}
```

