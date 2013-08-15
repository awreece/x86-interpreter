gp_registers = ["eax", "ebx", "ecx", "edx", "esi", "edi", "esp", "ebp"];
all_registers = ["eip"].concat(gp_registers)

flag_descriptions = {
    "CF": "Carry flag",
    "PF": "Parity flag",
    "AF": "Adjust flag",
    "ZF": "Zero flag",
    "SF": "Sign flag",
    "TF": "Trap flag",
    "IF": "Interrupt enable flag",
    "DF": "Direction flag",
    "OF": "Overflow flag",
    "IOPL": "I/O privilege level",
    "NT": "Nested task flag",
    "RF": "Resume flag",
    "VM": "Virtual 8086 mode flag",
    "AC": "Alignment check",
    "VIF": "Virtual interrupt flag",
    "VIP": "Virtual interrupt pending",
    "ID": "Able to use CPUID"
}

// How does javascript not have int->string with a specified width?
function hex(v) {
    var parts = new Array(8);
    for (var i = 0; i < 8; i++) {
        parts[8 - i] = (v & 0xf).toString(16);
        v >>= 4;
    }
    return "0x" + parts.join("");
}

var MAX_STACK = 10;

function State (prevState) {
    this.prevState = prevState;
    var self = this;
    if (prevState) {
        self.stack = prevState.stack.slice(0);
        all_registers.forEach(function (reg) {
            self[reg] = prevState[reg];
        });
        for (var flag in flag_descriptions) {
            self[flag] = prevState[flag];
        }
    } else {
        self.stack = new Array(MAX_STACK);
        for (var i = 0; i < MAX_STACK; i++) {
            self.stack[i] = 0;
        }
        for (var flag in flag_descriptions) {
            self[flag] = false;
        }
        self.IF = true;
        self.eax = 0; self.ebx = 0; self.ecx = 0; self.esi = 0; self.edi = 0;
        self.esp = self.stackBase - 4; self.ebp = self.stackBase - 4;
        self.eip = self.codeBase;
    }
}

State.prototype.stackBase = 0xfffffe00;
State.prototype.codeBase = 0x8040a00;
State.prototype.toString = function () {
    var self = this;
    var ret = "";
    for (var stackIndex = 0; stackIndex < this.stack.length; stackIndex++) {
        ret += hex(self.stackBase - (stackIndex << 2));
        ret += ": " + hex(self.stack[stackIndex]) + "\n";
    }
    gp_registers.slice(0,4).forEach(function (v) {
        ret += v + ": " + hex(self[v]) + " ";
    });
    ret += "\n";
    gp_registers.slice(4).forEach(function (v) {
        ret += v + ": " + hex(self[v]) + " ";
    });
    ret += "\n";
    ret += "eip: " + hex(self.eip) + " ";

    ret += "eflags: " ;
    for (var flag in flag_descriptions) {
        if (self[flag]) {
            ret += flag + " ";
        }
    }
    ret += "\n";
    return ret;
}

State.prototype.valid_address = function (address) {
    return address < this.stackBase &&
           (address + 4*MAX_STACK) >= this.stackBase;
}

State.prototype.getMemory = function(address) {
    if (!this.valid_address(address)) {
        throw "Invalid address " + hex(address);
    }
    stackIndex = (this.stackBase - address) >> 2;
    return this.stack[stackIndex];
}

State.prototype.setMemory = function(address, value) {
    if (!this.valid_address(address)) {
        throw "Invalid address " + hex(address);
    }
    stackIndex = (this.stackBase - address) >> 2;
    this.stack[stackIndex] = value;
}

State.prototype.push = function (val) {
   this.setMemory(this.esp, val);
   this.esp -= 4;
}

State.prototype.pop = function () {
   this.getMemory(this.esp);
   this.esp += 4;
}

function Command(name) {
    this.name = name;

    // The last argument is the callback.
    this.callback = arguments[arguments.length - 1];

    // Fuck you javascript, I want to be able to slice arguments.
    var slice = Function.prototype.call.bind(Array.prototype.slice);
    this.argumentTypes = slice(arguments, 1, arguments.length - 1);
}

function Register(state, reg) { this.state = state; this.reg = reg; }
Register.prototype.get = function () { return this.state[this.reg]; }
Register.prototype.set = function (val) { this.state[this.reg] = val; }
Register.regex = new RegExp("^%(" + all_registers.join("|") + ")", "i")
Register.match = function (state, string) {
    match = string.match(Register.regex);
    if (match) {
        return new Register(state, match[1]);
    } else {
        return null;
    }
}

function Immediate(val) { this.val = val; }
Immediate.prototype.get = function () { return this.val; }
Immediate.match = function (state, string) {
    match = string.match(/^\$(0x\d{1,8}|\d{1,10})$/i);
    if (match) {
        return new Immediate(parseInt(match[1]));
    } else {
        return null;
    }
}

function Memory(state, disp, base, index, stride) {
    this.state = state;
    this.disp = disp;
    this.base = base;
    this.index = index;
    this.stride = stride;
}

Memory.prototype.getAddress = function () {
    return this.disp + this.base + this.index * this.stride;
}
Memory.prototype.get = function () {
    return this.state.getMemory(this.getAddress());
}
Memory.prototype.set = function (val) {
    return this.state.setMemory(this.getAddress(), val);
}
Memory.match = function (state, string) {
    var disp = string.match(/^(-?0x\d{1,8}|-?\d{1,10})\(.*\)$/i);
    disp = (disp) ? parseInt(disp[1]) : 0;

    // Rest contains everything inside the parentheses.
    var rest = string.match(/^(-?0x\d{1,8}|-?\d{1,10})?\((.*)\)$/i);
    if (!rest) { return false; }  // All memory refs match that regex.
    rest = rest[2];

    var parts = rest.split(",");
    var base = Register.match(state, parts[0]).get();
    var index = (parts.length > 1) ? Register.match(state, parts[1]).get() : 0;
    var stride = (parts.length > 2) ? parseInt(parts[2]) : 1;

    return new Memory(state, disp, base, index, stride);
}

Command.prototype.match_and_run = function (state, string) {
    var self = this;
    var parts = string.split(" ");
    if (parts[0] !== this.name) {
        return false;
    }

    var callback_args = [state];

    var command_args = parts.slice(1).join("").split(",");
    if (command_args.length != self.argumentTypes.length) { return false; }

    // For each arg, attempt to match some possible type for that argument.
    command_args.forEach(function (arg, i) {
        var matched = self.argumentTypes[i].some(function (argType) {
            var match = argType.match(state, arg);
            if (match) { callback_args.push(match); }
            return match;
        });
        if (!matched) {
          throw "Invalid arg: " + arg + " for " + self.name;
        }
    });

    state.eip += 4;
    self.callback.apply(self, callback_args);
    return true;
}

var commands = [
    new Command("push", [Register, Immediate], function (state, val) {
        state.push(val.get());
    }),
    new Command("pop", [Register], function (state, reg) {
        reg.set(state.pop());
    }),
    new Command("mov", [Immediate, Register, Memory], [Register, Memory],
                function (state, src, dest) {
        dest.set(src.get());
    }),
    new Command("add", [Immediate, Register], [Register],
                function (state, src, dest) {
        dest.set(dest.get() + src.get());
        state.ZF = dest.get() == 0;
    }),
    new Command("xor", [Register, Immediate], [Register],
                function (state, src, dest) {
        dest.set(dest.get() ^ src.get());
        state.ZF = dest.get() == 0;
    }),
    new Command("sub", [Register, Immediate], [Register],
                function (state, src, dest) {
        dest.set(dest.get() - src.get());
        state.ZF = dest.get() == 0;
    }),
    new Command("call", [Immediate], function(state, imm) {
        state.push(eip);
        state.eip = imm.get();
    }),
    new Command("ret", function(state) { state.eip = state.pop(); }),
];

State.prototype.eval = function (string) {
    var self = this;
    var matched = commands.some(function (command) {
        return command.match_and_run(self, string);
    });
    if (!matched) {
        throw "No matching command for " + string;
    }
    return self;
}
