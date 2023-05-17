type BaseOperationSpec = {
  name: string;
  accumulatorCode?: number;
  immediateCode?: number;
  zeropageCode?: number;
  zeropageXCode?: number;
  zeropageYCode?: number;
  absoluteCode?: number;
  absoluteXCode?: number;
  absoluteYCode?: number;
  indirectXCode?: number;
  indirectYCode?: number;
};

type OperationProduct = {
    result: number;
    isOverflow?: boolean;
    isZero?: boolean;
    isNegative?: boolean;
    isCarry?: boolean;
    isSetter?: boolean;
    before?: number;
    after?: number;
    byte?: number;
}

type OperationSpecWithByte = BaseOperationSpec & {
  operation: (byte: number) => OperationProduct | void;
}

type OperationSpec = {
  name: string;
  code: number;
  operation: (...args: number[]) => OperationProduct | void;
}

export class Simulator {
  cycle = 0;

  codeToName: {
    [code: number]: string;
  } = {};

  ops: {
    [opcode: number]: (...args: number[]) => Simulator;
  } = {};

  #buffer = new ArrayBuffer(2 ** 16);
  #mem = new Uint8Array(this.#buffer);
  #registers = new Uint8Array(7);

  // 16-bit
  get #pc() {
    return this.#registers[1] << 8 | this.#registers[0];
  }

  set #pc(value: number) {
    this.#registers[0] = (value) & 0xFF;
    this.#registers[1] = (value) >> 8;
  }

  offsetProgramCounter(offset: number) {
    const arr = new Int8Array(1);
    arr[0] = offset;
    this.#pc += arr[0];
  }

  // 8-bit
  get #ac() {
    return this.#registers[2];
  }

  set #ac(val: number) {
    this.#registers[2] = val;
  }
  // 8-bit
  get #x() {
    return this.#registers[3];
  }

  set #x(val: number) {
    this.#registers[3] = val;
  }

  // 8-bit
  get #y() {
    return this.#registers[4];
  }

  set #y(val: number) {
    this.#registers[4] = val;
  }

  // NV-BDIZC
  // 8-bit
  get #sr() {
    return this.#registers[5];
  }

  set #sr(val: number) {
    this.#registers[5] = val;
  }

  // 8-bit
  get #sp() {
    return this.#registers[6];
  }

  set #sp(val: number) {
    this.#registers[6] = val;
  }

  get #zero() {
    return this.#sr & 0b00000010;
  }

  set #zero(val: number) {
    if (val) {
      this.#sr |= 0b00000010;
    } else {
      this.#sr &= 0b11111101;
    }
  }

  get #decimal() {
    return this.#sr & 0b00001000;
  }

  set #decimal(val: number) {
    if (val) {
      this.#sr |= 0b00001000;
    } else {
      this.#sr &= 0b11110111;
    }
  }

  get #interrupt() {
    return this.#sr & 0b00000100;
  }

  set #interrupt(val: number) {
    if (val) {
      this.#sr |= 0b00000100;
    } else {
      this.#sr &= 0b11111011;
    }
  }

  get #overflow() {
    return this.#sr & 0b01000000;
  }

  set #overflow(val: number) {
    if (val) {
      this.#sr |= 0b01000000;
    } else {
      this.#sr &= 0b10111111;
    }
  }

  get #carry() {
    return this.#sr & 0b00000001;
  }

  set #carry(val: number) {
    if (val) {
      this.#sr |= 0b00000001;
    } else {
      this.#sr &= 0b11111110;
    }
  }

  get #negative() {
    return this.#sr & 0b10000000;
  }

  set #negative(val: number) {
    if (val) {
      this.#sr |= 0b10000000;
    } else {
      this.#sr &= 0b01111111;
    }
  }

  #afterOperationActions(product: OperationProduct) {
    if (product.isNegative) {
      this.#negative = Number((product.after ?? 0) & 0b10000000);
    }

    if (product.isZero) {
      this.#zero = Number((product.after ?? 0) === 0);
    }

    if (product.isCarry) {
      this.#carry = Number(product.result > 0xFF);
    }

    if (product.isOverflow) {
      const beforeSign = (product.before ?? 0) & 0b10000000;
      const byteSign = (product.byte ?? 0) & 0b10000000;
      const afterSign = (product.after ?? 0) & 0b10000000;

      this.#overflow = Number(Boolean(beforeSign & byteSign) && Boolean(afterSign ^ beforeSign));
    }
  }

  #addOperationWithByte(spec: OperationSpecWithByte) {
    if (spec.accumulatorCode) {
      this.codeToName[spec.accumulatorCode] = spec.name + ' A';
      this.ops[spec.accumulatorCode] = () => {
        this.cycle++;
        const product = spec.operation(this.#ac);

        if (!product) {
          return this;
        }

        this.#afterOperationActions(product);

        if (product.isSetter) {
          this.#ac = product.result;
        }

        return this;
      }
    }


    if (spec.immediateCode) {
      this.codeToName[spec.immediateCode] = spec.name + ' #';
      this.ops[spec.immediateCode] = (val: number) => {
        this.cycle++;
        const product = spec.operation(val);

        if (!product) {
          return this;
        }

        this.#afterOperationActions(product);
        return this;
      }
    }

    if (spec.zeropageCode) {
      this.codeToName[spec.zeropageCode] = spec.name + ' zpg';
      this.ops[spec.zeropageCode] = (ll: number) => {
        this.cycle++;
        const product = spec.operation(this.get(ll));

        if (!product) {
          return this;
        }

        this.#afterOperationActions(product);

        if (product.isSetter) {
          this.set(ll, 0, 0, product.result);
        }

        return this;
      }
    }

    if (spec.zeropageXCode) {
      this.codeToName[spec.zeropageXCode] = spec.name + ' zpg, X';
      this.ops[spec.zeropageXCode] = (ll: number) => {
        this.cycle++;
        const product = spec.operation(this.get(ll, 0, this.#x));

        if (!product) {
          return this;
        }

        this.#afterOperationActions(product);

        if (product.isSetter) {
          this.set(ll, 0, this.#x, product.result);
        }

        return this;
      }
    }

    if (spec.zeropageYCode) {
      this.codeToName[spec.zeropageYCode] = spec.name  + ' zpg, Y';
      this.ops[spec.zeropageYCode] = (ll: number) => {
        this.cycle++;
        const product = spec.operation(this.get(ll, 0, this.#y));

        if (!product) {
          return this;
        }

        this.#afterOperationActions(product);

        if (product.isSetter) {
          this.set(ll, 0, this.#y, product.result);
        }

        return this;
      }
    }

    if (spec.absoluteCode) {
      this.codeToName[spec.absoluteCode] = spec.name + ' abs';
      this.ops[spec.absoluteCode] = (ll: number, hh: number) => {
        this.cycle++;
        const product = spec.operation(this.get(ll, hh));

        if (!product) {
          return this;
        }

        this.#afterOperationActions(product);

        if (product.isSetter) {
          this.set(ll, hh, 0, product.result);
        }

        return this;
      }
    }

    if (spec.absoluteXCode) {
      this.codeToName[spec.absoluteXCode] = spec.name + ' abs, X';
      this.ops[spec.absoluteXCode] = (ll: number, hh: number) => {
        this.cycle++;
        const product = spec.operation(this.get(ll, hh, this.#x));

        if (!product) {
          return this;
        }

        this.#afterOperationActions(product);

        if (product.isSetter) {
          this.set(ll, hh, this.#x, product.result);
        }

        return this;
      }
    }

    if (spec.absoluteYCode) {
      this.codeToName[spec.absoluteYCode] = spec.name + ' abs, Y';
      this.ops[spec.absoluteYCode] = (ll: number, hh: number) => {
        this.cycle++;
        const product = spec.operation(this.get(ll, hh, this.#y));

        if (!product) {
          return this;
        }

        this.#afterOperationActions(product);

        if (product.isSetter) {
          this.set(ll, hh, this.#y, product.result);
        }

        return this;
      }
    }

    if (spec.indirectXCode) {
      this.codeToName[spec.indirectXCode] = spec.name + ' (ind, X)';
      this.ops[spec.indirectXCode] = (ll: number) => {
        this.cycle++;
        const product = spec.operation(this.get(this.get(ll, 0, this.#x), this.get(ll, 0, this.#x + 1)));

        if (!product) {
          return this;
        }

        this.#afterOperationActions(product);

        if (product.isSetter) {
          this.set(this.get(ll, 0, this.#x), this.get(ll, 0, this.#x + 1), 0, product.result);
        }

        return this;
      }
    }

    if (spec.indirectYCode) {
      this.codeToName[spec.indirectYCode] = spec.name + ' (ind), Y';
      this.ops[spec.indirectYCode] = (ll: number) => {
        this.cycle++;
        const product = spec.operation(this.get(this.get(ll) + this.#y, this.get(ll, 0, 1)));

        if (!product) {
          return this;
        }

        this.#afterOperationActions(product);

        if (product.isSetter) {
          this.set(this.get(ll), this.get(ll, 0, 1), this.#y, product.result);
        }

        return this;
      }
    }
  }

  #addOperation(spec: OperationSpec) {
    this.codeToName[spec.code] = spec.name;
    this.ops[spec.code] = (...args: number[]) => {
      this.cycle++;
      const product = spec.operation(...args);

      if (product) {
        this.#afterOperationActions(product);
      }

      return this;
    }

    const handlerLength = {
      get(target: (...args: number[]) => Simulator, prop: string, receiver: any) {
        if (prop === 'length') {
          return spec.operation.length;
        }

        return Reflect.get(target, prop, receiver);
      }
    }

    this.ops[spec.code] = new Proxy(this.ops[spec.code], handlerLength);
  }

  constructor() {
    this.#sp = 0xFF;

    // ADC
    this.#addOperationWithByte({
      name: 'ADC',
      immediateCode: 0x69,
      zeropageCode: 0x65,
      zeropageXCode: 0x75,
      absoluteCode: 0x6D,
      absoluteXCode: 0x7D,
      absoluteYCode: 0x79,
      indirectXCode: 0x61,
      indirectYCode: 0x71,
      operation: (byte: number) => {
        const before = this.#ac;
        const result = this.#ac + byte + this.#carry;

        this.#ac = result;

        return {
          isNegative: true,
          isZero: true,
          isCarry: true,
          isOverflow: true,
          before,
          result,
          after: this.#ac,
          byte,
        };
      }
    });

    // AND
    this.#addOperationWithByte({
      name: 'AND',
      immediateCode: 0x29,
      zeropageCode: 0x25,
      zeropageXCode: 0x35,
      absoluteCode: 0x2D,
      absoluteXCode: 0x3D,
      absoluteYCode: 0x39,
      indirectXCode: 0x21,
      indirectYCode: 0x31,
      operation: (byte: number) => {
        const before = this.#ac;
        const result = this.#ac & byte;

        this.#ac &= byte;

        return {
          isNegative: true,
          isZero: true,
          before,
          result,
          after: this.#ac,
          byte,
        };
      }
    });

    // ASL
    this.#addOperationWithByte({
      name: 'ASL',
      accumulatorCode: 0x0A,
      zeropageCode: 0x06,
      zeropageXCode: 0x16,
      absoluteCode: 0x0E,
      absoluteXCode: 0x1E,
      operation: (byte: number) => {
        const before = byte;

        return {
          isNegative: true,
          isZero: true,
          isCarry: true,
          before: byte,
          result: before << 1,
          after: before << 1 & 0xFF,
          isSetter: true,
        }
      }
    });

    // BCC
    this.#addOperation({
      name: 'BCC',
      code: 0x90,
      operation: (offset: number) => {
        if (!this.#carry) {
          this.offsetProgramCounter(offset);
        }
      }
    });

    // BCS
    this.#addOperation({
      name: 'BCS',
      code: 0xB0,
      operation: (offset: number) => {
        if (this.#carry) {
          this.offsetProgramCounter(offset);
        }
      }
    });

    // BEQ
    this.#addOperation({
      name: 'BEQ',
      code: 0xF0,
      operation: (offset: number) => {
        if (this.#zero) {
          this.offsetProgramCounter(offset);
        }
      }
    });

    // BIT
    this.#addOperationWithByte({
      name: 'BIT',
      zeropageCode: 0x24,
      absoluteCode: 0x2C,
      operation: (byte: number) => {
        this.#zero = Number(this.#ac & byte);

        if (byte & 0b10000000) {
          this.#sr |= 0b10000000;
        } else {
          this.#sr &= 0b01111111;
        }

        if (byte & 0b00000010) {
          this.#sr |= 0b00000010;
        } else {
          this.#sr &= 0b11111101;
        }
      }
    });

    // BMI
    this.#addOperation({
      name: 'BMI',
      code: 0x30,
      operation: (offset: number) => {
        if (this.#negative) {
          this.offsetProgramCounter(offset);
        }
      }
    });

    // BNE
    this.#addOperation({
      name: 'BNE',
      code: 0xD0,
      operation: (offset: number) => {
        if (!this.#zero) {
          this.offsetProgramCounter(offset);
        }
      }
    });

    // BPL
    this.#addOperation({
      name: 'BPL',
      code: 0x10,
      operation: (offset: number) => {
        if (!this.#negative) {
          this.offsetProgramCounter(offset);
        }
      }
    });

    // BRK
    this.#addOperation({
      name: 'BRK',
      code: 0x00,
      operation: () => {
        this.#pc += 2;
        this.pushStackValue(this.#pc >> 8);
        this.pushStackValue(this.#pc & 0xFF);
        this.#sr |= 0b00000100;
        this.pushStackValue(this.#sr);
        this.#pc = this.get(0xFFFE) | this.get(0xFFFF) << 8;
      }
    });

    // BVC
    this.#addOperation({
      name: 'BVC',
      code: 0x50,
      operation: (offset: number) => {
        if (!this.#overflow) {
          this.offsetProgramCounter(offset);
        }
      }
    });

    // BVS
    this.#addOperation({
      name: 'BVS',
      code: 0x70,
      operation: (offset: number) => {
        if (this.#overflow) {
          this.offsetProgramCounter(offset);
        }
      }
    });

    // CLC
    this.#addOperation({
      name: 'CLC',
      code: 0x18,
      operation: () => { this.#carry = 0; }
    });

    // CLD
    this.#addOperation({
      name: 'CLD',
      code: 0xD8,
      operation: () => { this.#sr &= 0b11110111; }
    });

    // CLI
    this.#addOperation({
      name: 'CLI',
      code: 0x58,
      operation: () => { this.#sr &= 0b11111011; }
    });

    // CLV
    this.#addOperation({
      name: 'CLV',
      code: 0xB8,
      operation: () => { this.#overflow = 0; }
    });

    // CMP
    this.#addOperationWithByte({
      name: 'CMP',
      immediateCode: 0xC9,
      zeropageCode: 0xC5,
      zeropageXCode: 0xD5,
      absoluteCode: 0xCD,
      absoluteXCode: 0xDD,
      absoluteYCode: 0xD9,
      indirectXCode: 0xC1,
      indirectYCode: 0xD1,
      operation: (byte: number) => {
        const before = this.#ac;
        const result = this.#ac - byte;

        this.#ac = result;

        return {
          isNegative: true,
          isZero: true,
          isCarry: true,
          before,
          result,
          after: this.#ac,
          byte,
        };
      }
    });

    // CPX
    this.#addOperationWithByte({
      name: 'CPX',
      immediateCode: 0xE0,
      zeropageCode: 0xE4,
      absoluteCode: 0xEC,
      operation: (byte: number) => {
        const before = this.#x;
        const result = this.#x - byte;

        this.#x = result;

        return {
          isNegative: true,
          isZero: true,
          isCarry: true,
          before,
          result,
          after: this.#x,
          byte,
        };
      }
    });

    // CPY
    this.#addOperationWithByte({
      name: 'CPY',
      immediateCode: 0xC0,
      zeropageCode: 0xC4,
      absoluteCode: 0xCC,
      operation: (byte: number) => {
        const before = this.#y;
        const result = this.#y - byte;

        return {
          isNegative: true,
          isZero: true,
          isCarry: true,
          before,
          result,
          after: this.#y = result,
          byte,
        };
      }
    });

    // DEC
    this.#addOperationWithByte({
      name: 'DEC',
      zeropageCode: 0xC6,
      zeropageXCode: 0xD6,
      absoluteCode: 0xCE,
      absoluteXCode: 0xDE,
      operation: (byte: number) => {
        const before = byte;
        const result = byte - 1;

        return {
          isNegative: true,
          isZero: true,
          isSetter: true,
          before,
          result,
          after: result,
          byte,
        };
      }
    });

    // DEX
    this.#addOperation({
      name: 'DEX',
      code: 0xCA,
      operation: () => {
        const before = this.#x;
        const result = this.#x - 1;

        this.#x -= 1;
        
        return {
          isNegative: true,
          isZero: true,
          isSetter: true,
          before,
          result,
          after: this.#x
        };
      }
    });

    // DEY
    this.#addOperation({
      name: 'DEY',
      code: 0x88,
      operation: () => {
        const before = this.#y;
        const result = this.#y - 1;
        
        this.#y -= 1;

        return {
          isNegative: true,
          isZero: true,
          isSetter: true,
          before,
          result,
          after: this.#y
        };
      }
    });

    // EOR
    this.#addOperationWithByte({
      name: 'EOR',
      immediateCode: 0x49,
      zeropageCode: 0x45,
      zeropageXCode: 0x55,
      absoluteCode: 0x4D,
      absoluteXCode: 0x5D,
      absoluteYCode: 0x59,
      indirectXCode: 0x41,
      indirectYCode: 0x51,
      operation: (byte: number) => {
        const before = this.#ac;
        const result = this.#ac ^ byte;

        return {
          isNegative: true,
          isZero: true,
          before,
          result,
          after: this.#ac = result,
          byte,
        };
      }
    });

    // INC
    this.#addOperationWithByte({
      name: 'INC',
      zeropageCode: 0xE6,
      zeropageXCode: 0xF6,
      absoluteCode: 0xEE,
      absoluteXCode: 0xFE,
      operation: (byte: number) => {
        const before = byte;
        const result = byte + 1;

        return {
          isNegative: true,
          isZero: true,
          isSetter: true,
          before,
          result,
          after: result,
          byte,
        };
      }
    });

    // INX
    this.#addOperation({
      name: 'INX',
      code: 0xE8,
      operation: () => {
        const before = this.#x;
        const result = this.#x + 1;

        this.#x += 1;

        return {
          isNegative: true,
          isZero: true,
          isSetter: true,
          before,
          result,
          after: this.#x
        };
      }
    });

    // INY
    this.#addOperation({
      name: 'INY',
      code: 0xC8,
      operation: () => {
        const before = this.#y;
        const result = this.#y + 1;
        
        this.#y += 1;

        return {
          isNegative: true,
          isZero: true,
          isSetter: true,
          before,
          result,
          after: this.#y
        };
      }
    });

    // JMP
    this.#addOperation({
      name: 'JMP',
      code: 0x4C,
      operation: (ll: number, hh: number) => {
        this.#pc = (hh << 8) | ll;
      }
    });

    this.#addOperation({
      name: 'JMP',
      code: 0x6C,
      operation: (ll: number, hh: number) => {
        this.#pc = this.get(ll, hh) & 0xFF | (this.get(ll, hh, 1) << 8);
      }
    });

    // JSR
    this.#addOperation({
      name: 'JSR',
      code: 0x20,
      operation: (ll: number, hh: number) => {
        this.pushStackValue((this.#pc) >> 8);
        this.pushStackValue((this.#pc) & 0xFF);
        this.#pc = (hh << 8) | ll;
      }
    });

    // LDA
    this.#addOperationWithByte({
      name: 'LDA',
      immediateCode: 0xA9,
      zeropageCode: 0xA5,
      zeropageXCode: 0xB5,
      absoluteCode: 0xAD,
      absoluteXCode: 0xBD,
      absoluteYCode: 0xB9,
      indirectXCode: 0xA1,
      indirectYCode: 0xB1,
      operation: (byte: number) => {
        return {
          isNegative: true,
          isZero: true,
          before: this.#ac,
          result: byte,
          after: this.#ac = byte,
          byte,
        };
      }
    });

    // LDX
    this.#addOperationWithByte({
      name: 'LDX',
      immediateCode: 0xA2,
      zeropageCode: 0xA6,
      zeropageYCode: 0xB6,
      absoluteCode: 0xAE,
      absoluteYCode: 0xBE,
      operation: (byte: number) => {
        return {
          isNegative: true,
          isZero: true,
          before: this.#x,
          result: byte,
          after: this.#x = byte,
          byte,
        };
      }
    });

    // LDY
    this.#addOperationWithByte({
      name: 'LDY',
      immediateCode: 0xA0,
      zeropageCode: 0xA4,
      zeropageXCode: 0xB4,
      absoluteCode: 0xAC,
      absoluteXCode: 0xBC,
      operation: (byte: number) => {
        return {
          isNegative: true,
          isZero: true,
          before: this.#y,
          result: byte,
          after: this.#y = byte,
          byte,
        };
      }
    });

    // LSR
    this.#addOperationWithByte({
      name: 'LSR',
      accumulatorCode: 0x4A,
      zeropageCode: 0x46,
      zeropageXCode: 0x56,
      absoluteCode: 0x4E,
      absoluteXCode: 0x5E,
      operation: (byte: number) => {
        const before = byte;
        const result = byte >> 1;

        this.#carry = Number(byte & 1);

        return {
          isNegative: true,
          isZero: true,
          isSetter: true,
          before,
          result,
          after: result,
          byte,
        };
      }
    });

    // NOP
    this.#addOperation({
      name: 'NOP',
      code: 0xEA,
      operation: () => {}
    });

    // ORA
    this.#addOperationWithByte({
      name: 'ORA',
      immediateCode: 0x09,
      zeropageCode: 0x05,
      zeropageXCode: 0x15,
      absoluteCode: 0x0D,
      absoluteXCode: 0x1D,
      absoluteYCode: 0x19,
      indirectXCode: 0x01,
      indirectYCode: 0x11,
      operation: (byte: number) => {
        const before = this.#ac;
        const result = this.#ac | byte;

        return {
          isNegative: true,
          isZero: true,
          isSetter: true,
          before,
          result,
          after: result,
          byte,
        };
      }
    });

    // PHA
    this.#addOperation({
      name: 'PHA',
      code: 0x48,
      operation: () => {
        this.pushStackValue(this.#ac);
      }
    });

    // PHP
    this.#addOperation({
      name: 'PHP',
      code: 0x08,
      operation: () => {
        this.pushStackValue(this.#sr);
      }
    });

    // PLA
    this.#addOperation({
      name: 'PLA',
      code: 0x68,
      operation: () => {
        this.#ac = this.popStackValue();
        return {
          isNegative: true,
          isZero: true,
          result: this.#ac
        }
      }
    });

    // PLP
    this.#addOperation({
      name: 'PLP',
      code: 0x28,
      operation: () => {
        this.#sr = this.popStackValue();
      }
    });

    // ROL
    this.#addOperationWithByte({
      name: 'ROL',
      accumulatorCode: 0x2A,
      zeropageCode: 0x26,
      zeropageXCode: 0x36,
      absoluteCode: 0x2E,
      absoluteXCode: 0x3E,
      operation: (byte: number) => {
        const before = byte;
        const result = (byte << 1) | (this.#sr & 1);

        return {
          isNegative: true,
          isZero: true,
          isSetter: true,
          isCarry: true,
          before,
          result,
          after: result & 0xFF,
          byte,
        };
      }
    });

    // ROR
    this.#addOperationWithByte({
      name: 'ROR',
      accumulatorCode: 0x6A,
      zeropageCode: 0x66,
      zeropageXCode: 0x76,
      absoluteCode: 0x6E,
      absoluteXCode: 0x7E,
      operation: (byte: number) => {
        const before = byte;
        const result = (byte >> 1) | ((this.#sr & 1) << 7);

        this.#carry = Number(byte & 1);

        return {
          isNegative: true,
          isZero: true,
          isSetter: true,
          before,
          result,
          after: result & 0xFF,
          byte,
        };
      }
    });

    // RTI
    this.#addOperation({
      name: 'RTI',
      code: 0x40,
      operation: () => {
        this.#sr = this.popStackValue();
        this.#pc = this.popStackValue() | (this.popStackValue() << 8);
      }
    });

    // RTS
    this.#addOperation({
      name: 'RTS',
      code: 0x60,
      operation: () => {
        this.#pc = (this.popStackValue() | (this.popStackValue() << 8));
      }
    });

    // SBC
    this.#addOperationWithByte({
      name: 'SBC',
      immediateCode: 0xE9,
      zeropageCode: 0xE5,
      zeropageXCode: 0xF5,
      absoluteCode: 0xED,
      absoluteXCode: 0xFD,
      absoluteYCode: 0xF9,
      indirectXCode: 0xE1,
      indirectYCode: 0xF1,
      operation: (byte: number) => {
        const before = this.#ac;
        const result = this.#ac - byte - (1 - this.#carry);

        this.#carry = Number(result >= 0);
        this.#overflow = Number(((this.#ac ^ result) & 0x80) !== 0 && ((this.#ac ^ byte) & 0x80) !== 0);

        return {
          isNegative: true,
          isZero: true,
          isSetter: true,
          before,
          result,
          after: result & 0xFF,
          byte,
        };
      }
    });

    // SEC
    this.#addOperation({
      name: 'SEC',
      code: 0x38,
      operation: () => {
        this.#carry = 1;
      }
    });

    // SED
    this.#addOperation({
      name: 'SED',
      code: 0xF8,
      operation: () => {
        this.#decimal = 1;
      }
    });

    // SEI
    this.#addOperation({
      name: 'SEI',
      code: 0x78,
      operation: () => {
        this.#interrupt = 1;
      }
    });

    // STA
    this.#addOperationWithByte({
      name: 'STA',
      zeropageCode: 0x85,
      zeropageXCode: 0x95,
      absoluteCode: 0x8D,
      absoluteXCode: 0x9D,
      absoluteYCode: 0x99,
      indirectXCode: 0x81,
      indirectYCode: 0x91,
      operation: () => {
        return {
          before: this.#ac,
          after: this.#ac,
          result: this.#ac,
          isSetter: true,
        };
      }
    });

    // STX
    this.#addOperationWithByte({
      name: 'STX',
      zeropageCode: 0x86,
      zeropageYCode: 0x96,
      absoluteCode: 0x8E,
      operation: () => {
        return {
          before: this.#x,
          after: this.#x,
          result: this.#x,
          isSetter: true,
        };
      }
    });

    // STY
    this.#addOperationWithByte({
      name: 'STY',
      zeropageCode: 0x84,
      zeropageXCode: 0x94,
      absoluteCode: 0x8C,
      operation: () => {
        return {
          before: this.#y,
          after: this.#y,
          result: this.#y,
          isSetter: true,
        };
      }
    });
  
    // TAX
    this.#addOperation({
      name: 'TAX',
      code: 0xAA,
      operation: () => {
        this.#x = this.#ac
        return {
          isNegative: true,
          isZero: true,
          result: this.#x
        }
      }
    });

    // TAY
    this.#addOperation({
      name: 'TAY',
      code: 0xA8,
      operation: () => {
        this.#y = this.#ac;
        return {
          isNegative: true,
          isZero: true,
          result: this.#y
        };
      }
    });

    // TSX
    this.#addOperation({
      name: 'TSX',
      code: 0xBA,
      operation: () => {
        this.#x = this.#sp;
        return {
          isNegative: true,
          isZero: true,
          result: this.#x
        };
      }
    });

    // TXA
    this.#addOperation({
      name: 'TXA',
      code: 0x8A,
      operation: () => {
        this.#ac = this.#x;
        return {
          isNegative: true,
          isZero: true,
          result: this.#ac
        };
      }
    });

    // TXS
    this.#addOperation({
      name: 'TXS',
      code: 0x9A,
      operation: () => {
        this.#sp = this.#x;
      }
    });

    // TYA
    this.#addOperation({
      name: 'TYA',
      code: 0x98,
      operation: () => {
        this.#ac = this.#y;
        return {
          isNegative: true,
          isZero: true,
          result: this.#ac
        };
      }
    });

  }

  write(values: number[], targetOffset: number = 0) {
    this.#mem.set(values, targetOffset);
    return this;
  }

  getStackValue() {
    return this.#mem[0x0100 | this.#sp];
  }

  pushStackValue(val: number) {
    this.#mem[0x0100 | this.#sp--] = val;
  }

  popStackValue() {
    this.#sp++;
    return this.get(this.#sp, 0x01);
  }

  get(ll: number, hh: number = 0, offset: number = 0) {
    return this.#mem[hh << 8 | ll + offset];
  }

  set(ll: number, hh: number, offset: number, val: number) {
    if (hh === 0x40) {
      console.log('set', ll, hh, offset, val);
    }
    this.#mem[hh << 8 | ll + offset] = val;
  }

  fill(start: number, end: number, val: number) {
    this.#mem.fill(val, start, end);
  }

  getAccumulator() {
    return this.#ac;
  }

  getMemory() {
    return this.#mem;
  }

  getRegisters() {
    return this.#registers;
  }


  getNegative() {
    return this.#negative;
  }

  getStatusRegister() {
    return this.#sr;
  }

  getXRegister() {
    return this.#x;
  }

  getYRegister() {
    return this.#y;
  }

  getProgramCounter() {
    return this.#pc;
  }

  incProgramCounter() {
    return this.#pc++;
  }
}