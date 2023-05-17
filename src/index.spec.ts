import { Simulator } from '.';

describe('Simulator', () => {
  describe('Carry', () => {
    it('should add carry', () => {
      expect(
        new Simulator()
          .ops[0x18]()
          .ops[0xA9](0xFF)
      )
    });
  });

  describe('Logical', () => {
    it('AND', () => {
      const sim = new Simulator()
        .ops[0xA9](0b10101010);

      expect(sim.getNegative()).toEqual(0b10000000);

      sim.ops[0x29](0b01001100);

      expect(sim.getNegative()).toEqual(0b00000000);
      expect(sim.getAccumulator()).toEqual(0b00001000);
    });
  });

  describe('Accumulator', () => {
    it('immediate', () => {
      expect(
        new Simulator()
        .ops[0xA9](0x42)
          .getAccumulator()
      ).toEqual(0x42);
    });
    it('indirect,X', () => {
      expect(
        new Simulator()
          .write([0xA5], 0x3032)
          .write([0x32, 0x30], 0x0075)
          .ops[0xA2](0x05)
          .ops[0xA1](0x70)
          .getAccumulator()
      ).toEqual(0xA5)
    });
    it('indirect,Y', () => {
      expect(
        new Simulator()
          .write([0x23], 0x3553)
          .write([0x43, 0x35], 0x0070)
          .ops[0xA0](0x10)
          .ops[0xB1](0x70)
          .getAccumulator()
      ).toEqual(0x23);
    });
  });

  describe('Decrement', () => {
    it('absolute', () => {
      expect(
        new Simulator()
          .ops[0xA9](0x42)
          .ops[0x8D](0x00, 0x06)
          .ops[0xCE](0x00, 0x06)
          .ops[0xAD](0x00, 0x06)
          .getAccumulator()
      ).toEqual(0x41);
    });
  });

  describe('Without carry', () => {
    it('Decrement X', () => {
      const sim = new Simulator()
        .ops[0xA2](0x00)
        .ops[0xCA]();
      expect(sim.getStatusRegister()).toEqual(0b10000000);
      expect(sim.getXRegister()).toEqual(0xFF);
    });
  });

  describe('Jump', () => {
    it('indirect', () => {
      const sim = new Simulator()
        .ops[0xA9](0x42)
        .ops[0x8D](0x42, 0x00)
        .ops[0xA9](0x43)
        .ops[0x8D](0x43, 0x00)
        .ops[0x6C](0x42, 0x00);

      expect(sim.getProgramCounter()).toEqual(0x4342);
    });
  });
});